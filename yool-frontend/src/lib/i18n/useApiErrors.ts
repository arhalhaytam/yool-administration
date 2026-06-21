'use client';
/**
 * useApiErrors — returns a codeMap for getErrorMessage() so that
 * internal API error codes (NETWORK_ERROR, INVALID_RESPONSE) are
 * resolved to the user's current language automatically.
 *
 * Usage:
 *   const apiErrors = useApiErrors();
 *   getErrorMessage(err, t('common.error'), apiErrors)
 *
 * NOTE: the returned object is memoized on `t`, so its reference is
 * stable across renders. This lets callers safely place it in
 * useEffect / useCallback dependency arrays without re-firing.
 */
import { useMemo } from 'react';
import { useT } from '@/lib/i18n/LanguageContext';

export function useApiErrors(): Record<string, string> {
  const t = useT();
  return useMemo(
    () => ({
      NETWORK_ERROR:    t('errors.networkError'),
      INVALID_RESPONSE: t('errors.serverError'),
    }),
    [t],
  );
}
