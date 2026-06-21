// ─── Auth token management ────────────────────────────────────
// Access token stored in sessionStorage (cleared on tab close).
// Refresh token is an httpOnly cookie managed by the browser.

const ACCESS_TOKEN_KEY = 'yool_access_token';

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(ACCESS_TOKEN_KEY);
}

export function setAccessToken(token: string): void {
  sessionStorage.setItem(ACCESS_TOKEN_KEY, token);
}

export function clearAccessToken(): void {
  sessionStorage.removeItem(ACCESS_TOKEN_KEY);
}

export function isLoggedIn(): boolean {
  return !!getAccessToken();
}

/** Decode JWT payload (no verification — just read claims client-side). */
export function decodeToken(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

export function getRole(): string | null {
  const token = getAccessToken();
  if (!token) return null;
  const payload = decodeToken(token);
  return (payload?.role as string) ?? null;
}

export function getUserId(): string | null {
  const token = getAccessToken();
  if (!token) return null;
  const payload = decodeToken(token);
  return (payload?.sub as string) ?? null;
}
