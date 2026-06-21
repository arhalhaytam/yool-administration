/**
 * errors.ts — Shared client-side error helpers.
 *
 * Internal API error codes (thrown by api.ts) are resolved here with
 * built-in French fallbacks so no raw code ever leaks to the user — even
 * if a component forgets to pass the translated codeMap.
 *
 * Components that use useApiErrors() will override these fallbacks with the
 * user's current locale automatically.
 */

export class ApiError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * Built-in fallbacks for internal error codes thrown by api.ts.
 * French is the app default locale — these are shown only when a component
 * hasn't yet wired up useApiErrors().
 */
const CODE_FALLBACKS: Record<string, string> = {
  NETWORK_ERROR:    'Impossible de joindre le serveur. Vérifiez votre connexion.',
  INVALID_RESPONSE: 'Réponse invalide du serveur.',
  SESSION_EXPIRED:  'Session expirée. Veuillez vous reconnecter.',
};

/**
 * Normalize any thrown value into a readable user-facing message.
 *
 * Resolution order:
 *   1. codeMap (caller-supplied translations via useApiErrors())
 *   2. CODE_FALLBACKS (built-in French defaults for internal codes)
 *   3. err.message (backend detail string already formatted by formatApiDetail)
 *   4. fallback
 */
export function getErrorMessage(
  err: unknown,
  fallback = 'Une erreur est survenue.',
  codeMap?: Record<string, string>,
): string {
  if (err instanceof ApiError || err instanceof Error) {
    const msg = err.message || '';
    if (codeMap && msg in codeMap) return codeMap[msg];
    if (msg in CODE_FALLBACKS) return CODE_FALLBACKS[msg];
    return msg || fallback;
  }
  if (typeof err === 'string' && err.trim()) return err.trim();
  return fallback;
}

/** Run an async fn; returns `{ ok: true }` or `{ ok: false, message }`. */
export async function tryCatch<T>(
  fn: () => Promise<T>,
  fallback = 'Une erreur est survenue.',
): Promise<{ ok: true; value: T } | { ok: false; message: string }> {
  try {
    const value = await fn();
    return { ok: true, value };
  } catch (err) {
    return { ok: false, message: getErrorMessage(err, fallback) };
  }
}
