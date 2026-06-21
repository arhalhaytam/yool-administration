// ─── Shared domain types (aligned to backend Pydantic schemas) ────────────────

export type UserRole = 'super_admin' | 'admin' | 'teacher';

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  is_verified: boolean;
  is_deleted: boolean;
  created_at: string;
}

// SessionStatus mirrors the backend enum exactly
export type SessionStatus = 'created' | 'live' | 'processing' | 'done' | 'failed';

export interface Session {
  id: string;
  title: string;
  chapter_id: string;
  course_id: string;
  teacher_id: string;
  status: SessionStatus;
  dominant_language: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
}

export interface HierarchyItem {
  id: string;
  name: string;
}

export interface Level extends HierarchyItem {}
export interface Matiere extends HierarchyItem {}

export interface Chapter {
  id: string;
  course_id: string;
  title: string;
  order_index: number;
  created_at: string;
}

export interface Course {
  id: string;
  level_id: string;
  matiere_id: string;
  level?: HierarchyItem;
  matiere?: HierarchyItem;
  official_language: string;
  teacher_id: string;
  created_at: string;
  session_count: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface SessionStatusSummary {
  total: number;
  live: number;
  processing: number;
  done: number;
  failed: number;
  created: number;
}

export interface UserRoleSummary {
  total: number;
  teachers: number;
  admins: number;
  pending_invites: number;
}

// TranscriptSegment matches TranscriptSegmentOut from sessions router
export interface TranscriptSegment {
  id: string;
  speaker_role: string;
  speaker_label: string;
  text: string;
  language: string;
  segment_start_ms: number;
  segment_end_ms: number;
}

// Topic outline structure (inside Summary.content JSONB)
export interface Topic {
  start_time: string;
  end_time: string;
  title: string;
  description: string;
  key_concepts: string[];
}

// SummaryContent matches the JSONB written by stt/pipeline/processor.py exactly
export interface SummaryContent {
  session_title: string;
  session_id: string;
  course_title: string;
  teacher_name: string;   // full_name of the assigned teacher
  recorded_at: string;    // ISO datetime
  duration_minutes: number;
  language: string;
  topics: Topic[];
  context_score?: number | null;  // 0–1, added by finalize_worker
}

export interface Summary {
  id: string;
  session_id: string;
  content: SummaryContent;
  created_at: string;
}

// AuditLogOut from admin router — note: no actor_email field in the backend
export interface AuditLog {
  id: string;
  user_id: string | null;   // null for system/anonymous actions
  action: string;
  resource_type: string;
  resource_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

// Context adherence stats per teacher — from GET /sessions/stats/teacher-context
export interface TeacherContextStat {
  teacher_id: string;
  teacher_name: string;
  in_context: number;
  out_of_context: number;
}

// Aggregate stats from GET /sessions/stats/overview
export interface SessionStatsOverview {
  total_hours_minutes: number;
  avg_context_score: number | null;
  sessions_this_week: number;
  sessions_this_month: number;
  in_context: number;
  out_of_context: number;
  recent_sessions: Array<{
    id: string;
    title: string;
    status: SessionStatus;
    started_at: string | null;
  }>;
}

// TeacherInviteOut from admin router
export interface TeacherInvite {
  id: string;
  email: string;
  role: string;
  expires_at: string;
  used_at: string | null;
  is_pending: boolean;
  invite_url: string;  // shown once on creation; "<token not shown>" on list
}

export interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}
