'use client';

import { useCallback, useState } from 'react';
import { getErrorMessage } from '@/lib/errors';

type UseAsyncActionOptions = {
  onSuccess?: () => void;
  fallbackMessage?: string;
};

/**
 * Wraps an async mutation with loading + error state for buttons/forms.
 */
export function useAsyncAction<T extends unknown[]>(
  action: (...args: T) => Promise<void>,
  options: UseAsyncActionOptions = {},
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const clearError = useCallback(() => setError(''), []);

  const run = useCallback(
    async (...args: T) => {
      setError('');
      setLoading(true);
      try {
        await action(...args);
        options.onSuccess?.();
      } catch (err) {
        setError(getErrorMessage(err, options.fallbackMessage));
      } finally {
        setLoading(false);
      }
    },
    [action, options.fallbackMessage, options.onSuccess],
  );

  return { run, loading, error, clearError, setError };
}
