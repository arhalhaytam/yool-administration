import { getAccessToken, setAccessToken, clearAccessToken } from './auth';
import { ApiError } from './errors';
import type { Paginated } from './types';

/** Accept legacy array or paginated `{ items, total, ... }` API responses. */
export function normalizePaginated<T>(
  data: unknown,
  limit: number,
  offset: number,
): Paginated<T> {
  if (Array.isArray(data)) {
    const items = data as T[];
    return {
      items,
      total: items.length,
      limit,
      offset,
      has_more: items.length >= limit,
    };
  }
  if (data && typeof data === 'object' && Array.isArray((data as Paginated<T>).items)) {
    const page = data as Paginated<T>;
    return {
      items: page.items,
      total: typeof page.total === 'number' ? page.total : page.items.length,
      limit: typeof page.limit === 'number' ? page.limit : limit,
      offset: typeof page.offset === 'number' ? page.offset : offset,
      has_more: Boolean(page.has_more),
    };
  }
  return { items: [], total: 0, limit, offset, has_more: false };
}

async function requestPaginated<T>(
  path: string,
  limit: number,
  offset: number,
  opts: RequestOptions = {},
): Promise<Paginated<T>> {
  const data = await request<unknown>(path, opts);
  return normalizePaginated<T>(data, limit, offset);
}

// Call the backend directly from the browser — bypasses Next.js proxy and avoids
// the server-side self-signed cert issue in development.
const BACKEND = process.env.NEXT_PUBLIC_API_URL ?? '';
const BASE = `${BACKEND}/api`;

type RequestOptions = {
  method?: string;
  body?: unknown;
  token?: string | null;
};

/** Turn FastAPI `detail` (string, array, or object) into a readable message. */
export function formatApiDetail(detail: unknown): string {
  if (detail == null) return 'Request failed';
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map(item => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'msg' in item) {
          const loc = 'loc' in item && Array.isArray(item.loc)
            ? item.loc.filter((p: unknown) => p !== 'body').join('.')
            : '';
          return loc ? `${loc}: ${String(item.msg)}` : String(item.msg);
        }
        return JSON.stringify(item);
      })
      .join('; ');
  }
  if (typeof detail === 'object') {
    if ('msg' in detail) return String((detail as { msg: unknown }).msg);
    try {
      return JSON.stringify(detail);
    } catch {
      return 'Request failed';
    }
  }
  return String(detail);
}

async function parseErrorResponse(res: Response): Promise<string> {
  const fallback = `HTTP ${res.status}`;
  try {
    const data: unknown = await res.json();
    if (data && typeof data === 'object' && 'detail' in data) {
      return formatApiDetail((data as { detail: unknown }).detail);
    }
    if (typeof data === 'string') return data;
    if (data && typeof data === 'object' && 'message' in data) {
      return formatApiDetail((data as { message: unknown }).message);
    }
  } catch {
    try {
      const text = await res.text();
      if (text.trim()) return text.trim().slice(0, 240);
    } catch {
      /* ignore */
    }
  }
  return fallback;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, token } = opts;
  const accessToken = token !== undefined ? token : getAccessToken();

  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

  // 30-second timeout — prevents the browser hanging forever on slow OpenAI calls
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      credentials: 'include', // send httpOnly refresh-token cookie
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError('Request timed out. Please try again.', 504);
    }
    throw new ApiError('NETWORK_ERROR');
  }

  // Only auto-refresh when:
  //   1. We actually had an access token (not a public/unauthenticated call)
  //   2. The failing path is not an auth endpoint itself (login = wrong pw, refresh = loop)
  const hadToken = !!accessToken;
  const isAuthEndpoint = path.startsWith('/auth/login') || path.startsWith('/auth/refresh');
  if (res.status === 401 && hadToken && !isAuthEndpoint) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      return request<T>(path, { ...opts, token: getAccessToken() });
    } else {
      clearAccessToken();
      window.dispatchEvent(new CustomEvent('auth:expired'));
      throw new ApiError('Session expired', 401);
    }
  }

  if (!res.ok) {
    throw new ApiError(await parseErrorResponse(res), res.status);
  }

  if (res.status === 204) return undefined as T;
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError('INVALID_RESPONSE');
  }
}

async function tryRefresh(): Promise<boolean> {
  try {
    const data = await request<{ access_token: string }>('/auth/refresh', {
      method: 'POST',
      token: null,
    });
    setAccessToken(data.access_token);
    return true;
  } catch {
    return false;
  }
}

// ─── Auth ───────────────────────────────────────────────────────────────────
export const api = {
  auth: {
    login: (email: string, password: string) =>
      request<{ access_token: string }>('/auth/login', {
        method: 'POST', body: { email, password },
      }),
    logout: () => request<void>('/auth/logout', { method: 'POST' }),
    me: () => request<import('./types').User>('/auth/me'),
    forgotPassword: (email: string) =>
      request<void>('/auth/forgot-password', { method: 'POST', body: { email } }),
    resetPassword: (token: string, new_password: string) =>
      request<void>('/auth/reset-password', { method: 'POST', body: { token, new_password } }),

    // Backend: PUT /auth/users/me/password
    changePassword: (current_password: string, new_password: string) =>
      request<void>('/auth/users/me/password', {
        method: 'PUT', body: { current_password, new_password },
      }),

    verifyEmail: (token: string) =>
      request<void>(`/auth/verify-email?token=${encodeURIComponent(token)}`, {
        method: 'POST', token: null,
      }),

    // Backend: POST /auth/teacher-invites/accept — returns UserOut, NOT a token
    acceptInvite: (token: string, full_name: string, password: string) =>
      request<import('./types').User>('/auth/teacher-invites/accept', {
        method: 'POST', body: { token, full_name, password }, token: null,
      }),

    previewInvite: (token: string) =>
      request<{ email: string; role: string; expires_at: string }>(
        `/auth/teacher-invites/preview?token=${encodeURIComponent(token)}`,
        { token: null },
      ),

    // PATCH /auth/me — update own profile
    updateProfile: (body: { full_name: string }) =>
      request<import('./types').User>('/auth/me', { method: 'PATCH', body }),

    // GET /auth/sessions — list own active refresh-token sessions
    listSessions: () =>
      request<Array<{
        id: string;
        ip_address: string | null;
        user_agent: string | null;
        created_at: string;
        last_used_at: string | null;
        expires_at: string;
      }>>('/auth/sessions'),

    // DELETE /auth/sessions/{id} — revoke a specific device session
    revokeSession: (id: string) =>
      request<void>(`/auth/sessions/${id}`, { method: 'DELETE' }),

    // DELETE /auth/users/me — GDPR self-erasure (admin/super_admin only)
    deleteAccount: () =>
      request<void>('/auth/users/me', { method: 'DELETE' }),
  },

  // ─── Admin ────────────────────────────────────────────────────────────────
  admin: {
    listUsers: async (params?: {
      role?: string;
      role_group?: 'teacher' | 'admin';
      is_active?: boolean;
      search?: string;
      limit?: number;
      offset?: number;
    }) => {
      const limit = params?.limit ?? 50;
      const offset = params?.offset ?? 0;
      const q = new URLSearchParams();
      if (params?.role)        q.set('role', params.role);
      if (params?.role_group)  q.set('role_group', params.role_group);
      if (params?.is_active != null) q.set('is_active', String(params.is_active));
      if (params?.search)      q.set('search', params.search);
      q.set('limit', String(limit));
      q.set('offset', String(offset));
      return requestPaginated<import('./types').User>(`/auth/admin/users?${q}`, limit, offset);
    },

    usersSummary: () =>
      request<import('./types').UserRoleSummary>('/auth/admin/users/summary'),

    // GET /auth/admin/users/{id} — single user lookup
    getUser: (id: string) =>
      request<import('./types').User>(`/auth/admin/users/${id}`),

    createUser: (body: { email: string; password: string; full_name: string; role: string }) =>
      request<import('./types').User>('/auth/admin/users', { method: 'POST', body }),

    // Backend: POST /auth/admin/users/{id}/reset-password
    forceResetPassword: (userId: string, new_password: string) =>
      request<void>(`/auth/admin/users/${userId}/reset-password`, {
        method: 'POST', body: { new_password },
      }),

    updateUser: (id: string, body: Partial<{ full_name: string; is_active: boolean; role: string }>) =>
      request<import('./types').User>(`/auth/admin/users/${id}`, { method: 'PATCH', body }),

    // Backend: DELETE /auth/admin/users/{id}/erase
    eraseUser: (id: string) =>
      request<void>(`/auth/admin/users/${id}/erase`, { method: 'DELETE' }),

    // Backend: POST /auth/admin/teacher-invites
    createInvite: (email: string, role: string) =>
      request<import('./types').TeacherInvite>('/auth/admin/teacher-invites', {
        method: 'POST', body: { email, role },
      }),

    listInvites: async (params?: {
      pending_only?: boolean;
      search?: string;
      limit?: number;
      offset?: number;
    }) => {
      const limit = params?.limit ?? 50;
      const offset = params?.offset ?? 0;
      const q = new URLSearchParams();
      if (params?.pending_only) q.set('pending_only', 'true');
      if (params?.search)       q.set('search', params.search);
      q.set('limit', String(limit));
      q.set('offset', String(offset));
      return requestPaginated<import('./types').TeacherInvite>(
        `/auth/admin/teacher-invites?${q}`,
        limit,
        offset,
      );
    },

    // Backend: DELETE /auth/admin/teacher-invites/{id}  (not PATCH /revoke)
    revokeInvite: (id: string) =>
      request<void>(`/auth/admin/teacher-invites/${id}`, { method: 'DELETE' }),

    auditLogs: async (params?: {
      user_id?: string;
      action?: string;
      since?: string;
      until?: string;
      limit?: number;
      offset?: number;
    }) => {
      const limit = params?.limit ?? 50;
      const offset = params?.offset ?? 0;
      const q = new URLSearchParams();
      if (params?.user_id) q.set('user_id', params.user_id);
      if (params?.action)  q.set('action', params.action);
      if (params?.since)   q.set('since', params.since);
      if (params?.until)   q.set('until', params.until);
      q.set('limit', String(limit));
      q.set('offset', String(offset));
      return requestPaginated<import('./types').AuditLog>(
        `/auth/admin/audit-logs?${q}`,
        limit,
        offset,
      );
    },
  },

  // ─── Hierarchy (Levels & Matieres) ────────────────────────────────────────
  hierarchy: {
    listLevels: () => request<import('./types').Level[]>('/hierarchy/levels'),
    createLevel: (name: string) =>
      request<import('./types').Level>('/hierarchy/levels', { method: 'POST', body: { name } }),
    renameLevel: (id: string, name: string) =>
      request<import('./types').Level>(`/hierarchy/levels/${id}`, {
        method: 'PATCH', body: { name },
      }),
    deleteLevel: (id: string) =>
      request<void>(`/hierarchy/levels/${id}`, { method: 'DELETE' }),

    listMatieres: () => request<import('./types').Matiere[]>('/hierarchy/matieres'),
    createMatiere: (name: string) =>
      request<import('./types').Matiere>('/hierarchy/matieres', { method: 'POST', body: { name } }),
    renameMatiere: (id: string, name: string) =>
      request<import('./types').Matiere>(`/hierarchy/matieres/${id}`, {
        method: 'PATCH', body: { name },
      }),
    deleteMatiere: (id: string) =>
      request<void>(`/hierarchy/matieres/${id}`, { method: 'DELETE' }),
  },

  // ─── Chapters ─────────────────────────────────────────────────────────────
  chapters: {
    list: (course_id: string) => request<import('./types').Chapter[]>(`/chapters/?course_id=${course_id}`),
    create: (body: { course_id: string; title: string; order_index?: number }) =>
      request<import('./types').Chapter>('/chapters/', { method: 'POST', body }),
    update: (id: string, body: { title?: string; order_index?: number }) =>
      request<import('./types').Chapter>(`/chapters/${id}`, { method: 'PATCH', body }),
    delete: (id: string) => request<void>(`/chapters/${id}`, { method: 'DELETE' }),
  },

  // ─── Courses ──────────────────────────────────────────────────────────────
  courses: {
    list: async (params?: {
      assigned_to_me?: boolean;
      limit?: number;
      offset?: number;
      search?: string;
      level_id?: string;
      matiere_id?: string;
      teacher_id?: string;
      language?: string;
    }) => {
      const limit = params?.limit ?? 50;
      const offset = params?.offset ?? 0;
      const q = new URLSearchParams();
      if (params?.assigned_to_me) q.set('assigned_to_me', 'true');
      if (params?.search)         q.set('search', params.search);
      if (params?.level_id)       q.set('level_id', params.level_id);
      if (params?.matiere_id)     q.set('matiere_id', params.matiere_id);
      if (params?.teacher_id)     q.set('teacher_id', params.teacher_id);
      if (params?.language)       q.set('language', params.language);
      q.set('limit', String(limit));
      q.set('offset', String(offset));
      return requestPaginated<import('./types').Course>(`/courses/?${q}`, limit, offset);
    },
    get: (id: string) => request<import('./types').Course>(`/courses/${id}`),
    create: (body: { level_id: string; matiere_id: string; official_language: string; teacher_id: string }) =>
      request<import('./types').Course>('/courses/', { method: 'POST', body }),
    update: (id: string, body: { level_id?: string; matiere_id?: string; official_language?: string }) =>
      request<import('./types').Course>(`/courses/${id}`, { method: 'PATCH', body }),
    reassignTeacher: (id: string, teacher_id: string) =>
      request<import('./types').Course>(`/courses/${id}/teacher`, {
        method: 'PATCH', body: { teacher_id },
      }),
    delete: (id: string) => request<void>(`/courses/${id}`, { method: 'DELETE' }),
  },

  // ─── Sessions ─────────────────────────────────────────────────────────────
  sessions: {
    list: async (params?: {
      course_id?: string;
      chapter_id?: string;
      status?: import('./types').SessionStatus;
      limit?: number;
      offset?: number;
    }) => {
      const limit = params?.limit ?? 50;
      const offset = params?.offset ?? 0;
      const q = new URLSearchParams();
      if (params?.course_id)  q.set('course_id', params.course_id);
      if (params?.chapter_id) q.set('chapter_id', params.chapter_id);
      if (params?.status)    q.set('status', params.status);
      q.set('limit', String(limit));
      q.set('offset', String(offset));
      return requestPaginated<import('./types').Session>(`/sessions/?${q}`, limit, offset);
    },

    statusSummary: (params?: { course_id?: string; chapter_id?: string }) => {
      const q = new URLSearchParams();
      if (params?.course_id)  q.set('course_id', params.course_id);
      if (params?.chapter_id) q.set('chapter_id', params.chapter_id);
      const qs = q.toString();
      return request<import('./types').SessionStatusSummary>(
        `/sessions/summary${qs ? `?${qs}` : ''}`,
      );
    },
    get: (id: string) => request<import('./types').Session>(`/sessions/${id}`),

    // Backend: POST /sessions/chapters/{chapter_id}/start
    start: (chapter_id: string) =>
      request<import('./types').Session>(`/sessions/chapters/${chapter_id}/start`, {
        method: 'POST', body: { title: null }, // auto-title from backend
      }),

    end: (id: string) =>
      request<import('./types').Session>(`/sessions/${id}/end`, { method: 'POST' }),
    cancel: (id: string) =>
      request<import('./types').Session>(`/sessions/${id}/cancel`, { method: 'POST' }),
    teacherContextStats: () =>
      request<import('./types').TeacherContextStat[]>('/sessions/stats/teacher-context'),
    statsOverview: () =>
      request<import('./types').SessionStatsOverview>('/sessions/stats/overview'),

    update: (id: string, body: { title: string }) =>
      request<import('./types').Session>(`/sessions/${id}`, { method: 'PATCH', body }),

    summary: (id: string) =>
      request<import('./types').Summary>(`/sessions/${id}/summary`),
    retrySummary: (id: string) =>
      request<{ status: string; summary_id: string }>(`/stt/sessions/${id}/retry`, { method: 'POST' }),
    transcript: (id: string) =>
      request<import('./types').TranscriptSegment[]>(`/sessions/${id}/transcript`),
  },

  // ─── Query ────────────────────────────────────────────────────────────────
  query: {
    search: (body: {
      query: string;
      limit?: number;
      offset?: number;
      teacher_id?: string;
      course_id?: string;
      level_id?: string;
      matiere_id?: string;
      language?: string;
    }) =>
      request<{
        total: number;
        offset: number;
        limit: number;
        results: Array<{
          session_id: string;
          session_title: string | null;
          course_title: string | null;
          teacher_name: string | null;
          level: string | null;
          matiere: string | null;
          language: string | null;
          recorded_at: string | null;
          context_score: number | null;
          score: number;
          hybrid_score?: number;
          lexical_hit?: boolean;
          snippet: { topic_title?: string; topic_description?: string } | null;
        }>;
      }>('/query/search', { method: 'POST', body }),
  },
};
