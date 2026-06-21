'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, TrendingUp, TrendingDown, RefreshCw,
  Mail, Calendar, ShieldCheck, CheckCircle2, XCircle,
  BookOpen, Video, ArrowRight, Layers,
} from 'lucide-react';
import { api } from '@/lib/api';
import type { User, TeacherContextStat, Course } from '@/lib/types';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import FormAlert from '@/components/ui/FormAlert';
import { getErrorMessage } from '@/lib/errors';
import { validatePassword, type FieldErrors } from '@/lib/validation';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/Confirm';
import { useLocale, useT } from '@/lib/i18n/LanguageContext';
import { useApiErrors } from '@/lib/i18n/useApiErrors';
import styles from './page.module.css';

const CONTEXT_THRESHOLD = 0.6;

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('');
}

function roleLabel(role: string, t: (key: string) => string): string {
  if (role === 'super_admin') return t('admin.role.super_admin');
  if (role === 'admin') return t('admin.role.admin');
  return t('admin.role.teacher');
}

const roleVariant = (role: string) =>
  role === 'super_admin' ? 'danger' : role === 'admin' ? 'purple' : 'accent';

export default function ProfessorProfilePage() {
  const params      = useParams();
  const router      = useRouter();
  const t           = useT();
  const { locale }  = useLocale();
  const apiErrors   = useApiErrors();
  const { success, error: toastError } = useToast();
  const { confirm } = useConfirm();

  const userId = params.id as string;

  const [user,        setUser]        = useState<User | null>(null);
  const [ctxStat,     setCtxStat]     = useState<TeacherContextStat | null>(null);
  const [courses,     setCourses]     = useState<Course[]>([]);
  const [coursesLoading, setCoursesLoading] = useState(false);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [showReset,   setShowReset]   = useState(false);
  const [resetPw,     setResetPw]     = useState('');
  const [resetting,   setResetting]   = useState(false);
  const [togglingActive, setTogglingActive] = useState(false);
  const [resetFieldErrors, setResetFieldErrors] = useState<FieldErrors>({});

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    setError('');

    // Fetch the user directly; context stats are best-effort (teachers only).
    Promise.all([
      api.admin.getUser(userId),
      api.sessions.teacherContextStats().catch(() => [] as TeacherContextStat[]),
    ])
      .then(([fetchedUser, ctxStats]) => {
        setUser(fetchedUser);
        const stat = ctxStats.find(s => s.teacher_id === userId) ?? null;
        setCtxStat(stat);
      })
      .catch(err => setError(getErrorMessage(err, t('common.error'), apiErrors)))
      .finally(() => setLoading(false));
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch assigned courses (teachers only) ──────────────────────────
  useEffect(() => {
    if (!userId || !user || user.role !== 'teacher') return;
    let cancelled = false;
    setCoursesLoading(true);
    api.courses.list({ teacher_id: userId, limit: 100, offset: 0 })
      .then(page => {
        if (cancelled) return;
        setCourses(page.items ?? []);
      })
      .catch(() => { if (!cancelled) setCourses([]); })
      .finally(() => { if (!cancelled) setCoursesLoading(false); });
    return () => { cancelled = true; };
  }, [userId, user]);

  async function handleToggleActive() {
    if (!user) return;
    if (user.is_active) {
      const ok = await confirm(
        'Désactiver l\'utilisateur',
        `Voulez-vous désactiver le compte de ${user.full_name || user.email} ? Ils perdront immédiatement l'accès.`,
        { confirmLabel: 'Désactiver', cancelLabel: 'Annuler', variant: 'warning' },
      );
      if (!ok) return;
    }
    setTogglingActive(true);
    try {
      const updated = await api.admin.updateUser(user.id, { is_active: !user.is_active });
      setUser(updated);
      success(`Compte ${updated.is_active ? 'activé' : 'désactivé'} avec succès.`);
    } catch (err) {
      toastError(getErrorMessage(err, t('common.error'), apiErrors));
    } finally {
      setTogglingActive(false);
    }
  }

  async function handleForceReset() {
    if (!user) return;
    const pwErr = validatePassword(resetPw);
    if (pwErr) { setResetFieldErrors({ password: pwErr }); return; }
    setResetFieldErrors({});
    setResetting(true);
    try {
      await api.admin.forceResetPassword(user.id, resetPw);
      success(`Mot de passe réinitialisé pour ${user.email}`);
      setResetPw('');
      setShowReset(false);
    } catch (err) {
      toastError(getErrorMessage(err, t('common.error'), apiErrors));
    } finally {
      setResetting(false);
    }
  }

  // ── Context stats derived values ────────────────────────────────────
  const inCtx   = ctxStat?.in_context    ?? 0;
  const outCtx  = ctxStat?.out_of_context ?? 0;
  const totalCtx = inCtx + outCtx;
  const inPct   = totalCtx > 0 ? Math.round((inCtx  / totalCtx) * 100) : 0;
  const outPct  = totalCtx > 0 ? Math.round((outCtx / totalCtx) * 100) : 0;

  // ── Loading skeleton ─────────────────────────────────────────────────
  if (loading) {
    return (
      <div className={`${styles.page} ui-page`}>
        <Link href="/admin/users" className={styles.back}>
          <ArrowLeft size={14} /> Retour aux utilisateurs
        </Link>
        <div className={styles.skeletonHeader} />
        <div className={styles.skeletonCards} />
      </div>
    );
  }

  // ── Error state ──────────────────────────────────────────────────────
  if (error || !user) {
    return (
      <div className={`${styles.page} ui-page`}>
        <Link href="/admin/users" className={styles.back}>
          <ArrowLeft size={14} /> Retour aux utilisateurs
        </Link>
        <FormAlert message={error || 'Utilisateur introuvable.'} />
      </div>
    );
  }

  const isTeacher  = user.role === 'teacher';
  const hasCtxData = isTeacher && totalCtx > 0;
  const l = {
    en: {
      adherence: 'Program adherence',
      noContextData: 'No finalized sessions yet — adherence stats will appear after the first session.',
      inContext: 'Sessions in context',
      outContext: 'Sessions out of context',
      ofTotal: 'of total',
    },
    fr: {
      adherence: 'Adhérence au programme',
      noContextData: 'Aucune séance finalisée — les statistiques d\'adhérence apparaîtront après la première session.',
      inContext: 'Séances en contexte',
      outContext: 'Séances hors contexte',
      ofTotal: 'du total',
    },
    ar: {
      adherence: 'الالتزام بالبرنامج',
      noContextData: 'لا توجد جلسات منتهية بعد — ستظهر إحصاءات الالتزام بعد الجلسة الأولى.',
      inContext: 'جلسات ضمن السياق',
      outContext: 'جلسات خارج السياق',
      ofTotal: 'من الإجمالي',
    },
  }[locale];

  // ── Group assigned courses by subject for the "smart" view ───────────
  const courseGroups = (() => {
    if (!isTeacher) return [];
    const bySubject = new Map<
      string,
      { subject: string; matiereId: string; courses: Course[]; totalSessions: number }
    >();
    for (const c of courses) {
      const key = c.matiere?.id || c.matiere_id;
      const name = c.matiere?.name || '—';
      const entry = bySubject.get(key) ?? {
        subject: name,
        matiereId: key,
        courses: [],
        totalSessions: 0,
      };
      entry.courses.push(c);
      entry.totalSessions += c.session_count ?? 0;
      bySubject.set(key, entry);
    }
    return Array.from(bySubject.values()).sort(
      (a, b) => b.totalSessions - a.totalSessions || a.subject.localeCompare(b.subject),
    );
  })();

  const totalSessions = courses.reduce((s, c) => s + (c.session_count ?? 0), 0);

  return (
    <div className={`${styles.page} ui-page`}>
      {/* Back link */}
      <Link href="/admin/users" className={styles.back}>
        <ArrowLeft size={14} /> Retour aux utilisateurs
      </Link>

      {/* Profile header card */}
      <div className={styles.profileCard}>
        <div className={styles.avatar}>
          {getInitials(user.full_name || user.email)}
        </div>
        <div className={styles.profileInfo}>
          <div className={styles.profileName}>{user.full_name || '—'}</div>
          <div className={styles.profileMeta}>
            <span className={styles.metaItem}>
              <Mail size={12} />
              {user.email}
            </span>
            <span className={styles.metaItem}>
              <Calendar size={12} />
              Depuis le {new Date(user.created_at).toLocaleDateString('fr-DZ')}
            </span>
          </div>
          <div className={styles.profileBadges}>
            <Badge variant={roleVariant(user.role)}>{roleLabel(user.role, t)}</Badge>
            {user.is_deleted ? (
              <Badge variant="default">Supprimé</Badge>
            ) : user.is_active ? (
              <Badge variant="success" dot>Actif</Badge>
            ) : (
              <Badge variant="default" dot>Inactif</Badge>
            )}
            {user.is_verified && (
              <Badge variant="accent">
                <ShieldCheck size={10} className={styles.verifiedIcon} />Vérifié
              </Badge>
            )}
          </div>
        </div>

        {/* Actions */}
        {!user.is_deleted && (
          <div className={styles.profileActions}>
            <Button
              size="sm"
              variant={user.is_active ? 'ghost' : 'ghost'}
              onClick={handleToggleActive}
              loading={togglingActive}
            >
              {user.is_active ? (
                <><XCircle size={13} /> Désactiver</>
              ) : (
                <><CheckCircle2 size={13} /> Activer</>
              )}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowReset(true)}
            >
              <RefreshCw size={13} /> Réinitialiser mdp
            </Button>
          </div>
        )}
      </div>

      {/* Context adherence section — teachers only */}
      {isTeacher && (
        <div className={styles.contextSection}>
          <div className={styles.contextTitle}>
            <TrendingUp size={16} />
            {l.adherence}
          </div>

          {!hasCtxData ? (
            <div className={styles.contextEmpty}>
              {l.noContextData}
            </div>
          ) : (
            <>
              <div className={styles.contextCards}>
                {/* In context */}
                <div className={styles.contextCard} data-variant="success">
                  <div className={styles.contextCardIcon}>
                    <TrendingUp size={20} strokeWidth={2} />
                  </div>
                  <div className={styles.contextCardBody}>
                    <div className={styles.contextCardValue}>{inCtx}</div>
                    <div className={styles.contextCardLabel}>{l.inContext}</div>
                    <div className={styles.contextCardPct}>{inPct}% {l.ofTotal}</div>
                  </div>
                </div>

                {/* Out of context */}
                <div className={styles.contextCard} data-variant="danger">
                  <div className={styles.contextCardIcon}>
                    <TrendingDown size={20} strokeWidth={2} />
                  </div>
                  <div className={styles.contextCardBody}>
                    <div className={styles.contextCardValue}>{outCtx}</div>
                    <div className={styles.contextCardLabel}>{l.outContext}</div>
                    <div className={styles.contextCardPct}>{outPct}% {l.ofTotal}</div>
                  </div>
                </div>
              </div>

              {/* Visual ratio bar — width is data-driven, must stay inline */}
              <div className={styles.ratioBar}>
                <div
                  className={styles.ratioBarFill}
                  ref={(el) => {
                    if (el) el.style.width = `${inPct}%`;
                  }}
                />
              </div>
              <div className={styles.ratioLabels}>
                <span className={styles.ratioLabelIn}>{inPct}% {l.inContext}</span>
                <span className={styles.ratioLabelOut}>{outPct}% {l.outContext}</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* Assigned courses — teachers only */}
      {isTeacher && (
        <div className={styles.coursesSection}>
          <div className={styles.coursesHead}>
            <div className={styles.coursesTitleRow}>
              <BookOpen size={16} />
              <span className={styles.coursesTitle}>Cours assignés</span>
            </div>
            {!coursesLoading && courses.length > 0 && (
              <div className={styles.coursesSummary}>
                <span className={styles.summaryStat}>
                  <em>{courses.length}</em>
                  {courses.length === 1 ? 'cours' : 'cours'}
                </span>
                <span className={styles.summaryDivider} aria-hidden="true">·</span>
                <span className={styles.summaryStat}>
                  <em>{courseGroups.length}</em>
                  {courseGroups.length === 1 ? 'matière' : 'matières'}
                </span>
                <span className={styles.summaryDivider} aria-hidden="true">·</span>
                <span className={styles.summaryStat}>
                  <em>{totalSessions}</em>
                  séances
                </span>
              </div>
            )}
          </div>

          {coursesLoading ? (
            <div className={styles.coursesSkeleton}>
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className={`skeleton-line ${styles.skLine}`} />
              ))}
            </div>
          ) : courses.length === 0 ? (
            <div className={styles.coursesEmpty}>
              <BookOpen size={20} strokeWidth={1.8} className={styles.coursesEmptyIcon} />
              <div>
                <div className={styles.coursesEmptyTitle}>Aucun cours assigné</div>
                <div className={styles.coursesEmptySub}>
                  Cet enseignant n&apos;est rattaché à aucun cours pour le moment.
                </div>
              </div>
            </div>
          ) : (
            <ul className={styles.subjectGroups} role="list">
              {courseGroups.map((group) => {
                const total = courses.length;
                const groupPct = total > 0 ? Math.round((group.courses.length / total) * 100) : 0;
                return (
                  <li key={group.matiereId} className={styles.subjectGroup}>
                    <div className={styles.subjectHead}>
                      <span className={styles.subjectMark} aria-hidden="true" />
                      <span className={styles.subjectName} title={group.subject}>
                        {group.subject}
                      </span>
                      <span className={styles.subjectChip}>
                        {group.courses.length}{' '}
                        {group.courses.length === 1 ? 'niveau' : 'niveaux'}
                      </span>
                      <div
                        className={styles.subjectBar}
                        role="img"
                        aria-label={`${groupPct}% des cours assignés`}
                      >
                        <span
                          className={styles.subjectBarFill}
                          ref={(el) => {
                            if (el) el.style.width = `${groupPct}%`;
                          }}
                        />
                      </div>
                      <span className={styles.subjectBarPct}>{groupPct}%</span>
                    </div>
                    <ul className={styles.courseList} role="list">
                      {group.courses
                        .slice()
                        .sort((a, b) =>
                          (a.level?.name ?? '').localeCompare(b.level?.name ?? ''),
                        )
                        .map((c) => {
                          const n = c.session_count ?? 0;
                          const lang = (c.official_language || 'fr').toUpperCase();
                          return (
                            <li key={c.id} className={styles.courseItem}>
                              <Link
                                href={`/admin/courses/${c.id}`}
                                className={styles.courseLink}
                              >
                                <span className={styles.courseLevelChip} aria-hidden="true">
                                  <Layers size={11} strokeWidth={2} />
                                </span>
                                <span
                                  className={styles.courseLevel}
                                  title={c.level?.name ?? ''}
                                >
                                  {c.level?.name ?? '—'}
                                </span>
                                <span className={styles.courseLang}>{lang}</span>
                                <span className={styles.courseSessions}>
                                  <Video size={11} strokeWidth={2} />
                                  <strong>{n}</strong>
                                  <em>{n === 1 ? 'séance' : 'séances'}</em>
                                </span>
                                <ArrowRight
                                  size={13}
                                  strokeWidth={2}
                                  className={styles.courseArrow}
                                />
                              </Link>
                            </li>
                          );
                        })}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* Force reset password modal */}
      <Modal
        isOpen={showReset}
        onClose={() => { setShowReset(false); setResetPw(''); setResetFieldErrors({}); }}
        title="Réinitialiser le mot de passe"
        subtitle={user.email}
        size="md"
      >
        <div className={styles.modalForm}>
          <Input
            label="Nouveau mot de passe"
            type="password"
            value={resetPw}
            onChange={e => { setResetPw(e.target.value); if (resetFieldErrors.password) setResetFieldErrors({}); }}
            error={resetFieldErrors.password}
            hint="Min 8 caractères, une majuscule, un chiffre"
            autoFocus
          />
          <div className={styles.modalActions}>
            <Button variant="ghost" onClick={() => { setShowReset(false); setResetPw(''); }}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={handleForceReset} loading={resetting}>
              Réinitialiser
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
