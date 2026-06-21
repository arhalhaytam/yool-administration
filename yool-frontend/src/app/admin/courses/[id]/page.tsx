'use client';
import { useEffect, useState } from 'react';
import { use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { Course, Session, User, Level, Matiere } from '@/lib/types';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import PageHeader from '@/components/ui/PageHeader';
import SectionHeader from '@/components/ui/SectionHeader';
import EmptyState from '@/components/ui/EmptyState';
import { BookOpen, Video } from 'lucide-react';
import FormAlert from '@/components/ui/FormAlert';
import { getErrorMessage } from '@/lib/errors';
import { validateRequired, type FieldErrors } from '@/lib/validation';
import { useLocale } from '@/lib/i18n/LanguageContext';
import styles from './page.module.css';

function StatusBadge({ status, locale }: { status: Session['status']; locale: 'en' | 'fr' | 'ar' }) {
  const labels = {
    en: { done: 'Done', processing: 'Processing', live: 'Live', failed: 'Failed', created: 'Created' },
    fr: { done: 'Terminé', processing: 'En cours', live: 'Live', failed: 'Échoué', created: 'Créé' },
    ar: { done: 'مكتمل', processing: 'قيد المعالجة', live: 'مباشر', failed: 'فشل', created: 'تم الإنشاء' },
  }[locale];
  const map: Record<string, { v: 'success' | 'warning' | 'danger' | 'default' | 'accent'; l: string; dot?: boolean }> = {
    done: { v: 'success', l: labels.done },
    processing: { v: 'warning', l: labels.processing },
    live: { v: 'danger', l: labels.live, dot: true },
    failed: { v: 'default', l: labels.failed },
    created: { v: 'accent', l: labels.created },
  };
  const cfg = map[status] ?? map.created;
  return <Badge variant={cfg.v} dot={!!cfg.dot} pulse={!!cfg.dot}>{cfg.l}</Badge>;
}

export default function CourseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { locale, isRTL } = useLocale();
  const l = {
    en: {
      courseNotFound: 'Course not found',
      noAccess: 'It may have been deleted or you may not have access.',
      backToCourses: 'Back to courses',
      level: 'Level',
      subject: 'Subject',
      officialLanguage: 'Official language',
      assignedTeacher: 'Assigned teacher',
      selectLevel: 'Select level',
      selectSubject: 'Select subject',
      selectLanguage: 'Select an official language',
      selectTeacher: 'Select a teacher',
      fixFields: 'Please fix the highlighted fields.',
      failedLoad: 'Failed to load course',
      failedSave: 'Failed to save course',
      failedDelete: 'Failed to delete course',
      edit: 'Edit',
      delete: 'Delete',
      cancel: 'Cancel',
      saveChanges: 'Save changes',
      created: 'Created',
      teacher: 'Teacher',
      sessionsForCourse: 'Sessions for this course',
      title: 'Title',
      status: 'Status',
      started: 'Started',
      noSessions: 'No sessions yet',
      sessionsDesc: 'Sessions appear when an instructor records for this course.',
      outline: 'Outline',
      assignedTo: 'Assigned to',
      session: 'session',
      sessions: 'sessions',
      deleteConfirm: 'Delete course "{title}"? This removes all sessions and transcripts for this course.',
      courseLoadAccess: 'Course not found or you do not have access.',
      courses: 'Courses',
    },
    fr: {
      courseNotFound: 'Cours introuvable',
      noAccess: 'Il a peut-être été supprimé ou vous n’y avez pas accès.',
      backToCourses: 'Retour aux cours',
      level: 'Niveau',
      subject: 'Matière',
      officialLanguage: 'Langue officielle',
      assignedTeacher: 'Enseignant assigné',
      selectLevel: 'Sélectionner un niveau',
      selectSubject: 'Sélectionner une matière',
      selectLanguage: 'Sélectionner une langue officielle',
      selectTeacher: 'Sélectionner un enseignant',
      fixFields: 'Veuillez corriger les champs en surbrillance.',
      failedLoad: 'Échec du chargement du cours',
      failedSave: 'Échec de l’enregistrement du cours',
      failedDelete: 'Échec de la suppression du cours',
      edit: 'Modifier',
      delete: 'Supprimer',
      cancel: 'Annuler',
      saveChanges: 'Enregistrer',
      created: 'Créé',
      teacher: 'Enseignant',
      sessionsForCourse: 'Séances de ce cours',
      title: 'Titre',
      status: 'Statut',
      started: 'Début',
      noSessions: 'Aucune séance',
      sessionsDesc: 'Les séances apparaissent lorsqu’un enseignant enregistre ce cours.',
      outline: 'Plan',
      assignedTo: 'Attribué à',
      session: 'séance',
      sessions: 'séances',
      deleteConfirm: 'Supprimer le cours "{title}" ? Cela supprime toutes les séances et transcriptions de ce cours.',
      courseLoadAccess: 'Cours introuvable ou accès refusé.',
      courses: 'Cours',
    },
    ar: {
      courseNotFound: 'المقرر غير موجود',
      noAccess: 'قد يكون تم حذفه أو ليس لديك صلاحية الوصول.',
      backToCourses: 'العودة إلى المقررات',
      level: 'المستوى',
      subject: 'المادة',
      officialLanguage: 'اللغة الرسمية',
      assignedTeacher: 'الأستاذ المعيّن',
      selectLevel: 'اختر مستوى',
      selectSubject: 'اختر مادة',
      selectLanguage: 'اختر اللغة الرسمية',
      selectTeacher: 'اختر أستاذاً',
      fixFields: 'يرجى تصحيح الحقول المميزة.',
      failedLoad: 'فشل تحميل المقرر',
      failedSave: 'فشل حفظ المقرر',
      failedDelete: 'فشل حذف المقرر',
      edit: 'تعديل',
      delete: 'حذف',
      cancel: 'إلغاء',
      saveChanges: 'حفظ التغييرات',
      created: 'تم الإنشاء',
      teacher: 'الأستاذ',
      sessionsForCourse: 'جلسات هذا المقرر',
      title: 'العنوان',
      status: 'الحالة',
      started: 'البداية',
      noSessions: 'لا توجد جلسات',
      sessionsDesc: 'تظهر الجلسات عندما يقوم الأستاذ بالتسجيل لهذا المقرر.',
      outline: 'المخطط',
      assignedTo: 'مُسند إلى',
      session: 'جلسة',
      sessions: 'جلسات',
      deleteConfirm: 'هل تريد حذف المقرر "{title}"؟ سيؤدي ذلك إلى حذف جميع الجلسات والتفريغات لهذا المقرر.',
      courseLoadAccess: 'المقرر غير موجود أو لا تملك صلاحية الوصول.',
      courses: 'المقررات',
    },
  }[locale];
  const [course, setCourse] = useState<Course | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [teachers, setTeachers] = useState<User[]>([]);
  const [teacher, setTeacher] = useState<User | null>(null);
  const [levels, setLevels] = useState<Level[]>([]);
  const [matieres, setMatieres] = useState<Matiere[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ level_id: '', matiere_id: '', official_language: 'fr', teacher_id: '' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    Promise.all([
      api.courses.get(id).catch(() => null),
      api.sessions.list({ course_id: id, limit: 80 }),
      api.admin.listUsers({ role_group: 'teacher', limit: 500 }),
      api.hierarchy.listLevels(),
      api.hierarchy.listMatieres(),
    ])
      .then(([c, s, t, lvls, mats]) => {
        if (cancelled) return;
        if (!c) {
          setNotFound(true);
          setCourse(null);
          setLoadError(l.courseLoadAccess);
          return;
        }
        setCourse(c);
        setSessions(s.items);
        setTeachers(t.items);
        setLevels(lvls ?? []);
        setMatieres(mats ?? []);
        setForm({
          level_id: c.level_id,
          matiere_id: c.matiere_id,
          official_language: c.official_language || 'fr',
          teacher_id: c.teacher_id,
        });
        setTeacher(t.items.find(u => u.id === c.teacher_id) ?? null);
        setLoadError('');
      })
      .catch((err) => {
        if (!cancelled) setLoadError(getErrorMessage(err, l.failedLoad));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function handleSave() {
    if (!course) return;
    const errors: FieldErrors = {};
    if (!form.level_id) errors.level_id = l.selectLevel;
    if (!form.matiere_id) errors.matiere_id = l.selectSubject;
    if (!form.official_language) errors.official_language = l.selectLanguage;
    if (!form.teacher_id) errors.teacher_id = l.selectTeacher;
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setSaveError(l.fixFields);
      return;
    }
    setSaveError('');
    setSaving(true);
    try {
      await api.courses.update(id, {
        level_id: form.level_id,
        matiere_id: form.matiere_id,
        official_language: form.official_language,
      });
      if (form.teacher_id !== course.teacher_id) {
        await api.courses.reassignTeacher(id, form.teacher_id);
      }
      const updated = await api.courses.get(id);
      setCourse(updated);
      setTeacher(teachers.find(u => u.id === updated.teacher_id) ?? null);
      setEditing(false);
      setFieldErrors({});
    } catch (err) {
      setSaveError(getErrorMessage(err, l.failedSave));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className={styles.loadingState}>
        <div className={`skeleton-line ${styles.loadBar1}`} />
        <div className={`skeleton-line ${styles.loadBar2}`} />
        <div className={`skeleton-line ${styles.loadBar3}`} />
      </div>
    );
  }

  if (notFound || !course) {
    return (
      <div className={styles.notFound}>
        <EmptyState
          icon={BookOpen}
          title={l.courseNotFound}
          description={l.noAccess}
          action={<Button variant="outline" onClick={() => router.push('/admin/courses')}>{l.backToCourses}</Button>}
        />
      </div>
    );
  }

  const courseTitle = course ? `${course.matiere?.name || l.subject} - ${course.level?.name || l.level}` : '';

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: l.courses, href: '/admin/courses' },
          { label: courseTitle },
        ]}
        title={courseTitle}
        subtitle={`${(course.official_language || 'fr').toUpperCase()} · ${sessions.length} ${sessions.length !== 1 ? l.sessions : l.session} · ${l.assignedTo} ${teacher?.full_name ?? '—'}`}
        border
        action={
          !editing ? (
            <div className={styles.headerActions}>
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>{l.edit}</Button>
              <Button
                variant="danger"
                size="sm"
                onClick={async () => {
                  if (!confirm(l.deleteConfirm.replace('{title}', courseTitle))) return;
                  setActionError('');
                  try {
                    await api.courses.delete(id);
                    router.push('/admin/courses');
                  } catch (err) {
                    setActionError(getErrorMessage(err, l.failedDelete));
                  }
                }}
              >
                {l.delete}
              </Button>
            </div>
          ) : null
        }
      />

      {loadError && <FormAlert message={loadError} className={styles.pageAlert} />}
      {actionError && <FormAlert message={actionError} className={styles.pageAlert} />}

      {editing ? (
        <div className={`panel ${styles.editCard}`}>
          <div className={styles.editGrid}>
            <Select
              id="course-level"
              label={l.level}
              value={form.level_id}
              onChange={e => setForm(f => ({ ...f, level_id: e.target.value }))}
              error={fieldErrors.level_id}
            >
              <option value="">{l.selectLevel}</option>
              {levels.map(l => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </Select>
            <Select
              id="course-matiere"
              label={l.subject}
              value={form.matiere_id}
              onChange={e => setForm(f => ({ ...f, matiere_id: e.target.value }))}
              error={fieldErrors.matiere_id}
            >
              <option value="">{l.selectSubject}</option>
              {matieres.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </Select>
            <Select
              id="course-lang"
              label={l.officialLanguage}
              value={form.official_language}
              onChange={e => setForm(f => ({ ...f, official_language: e.target.value }))}
              error={fieldErrors.official_language}
            >
              <option value="fr">French (fr)</option>
              <option value="ar">Arabic (ar)</option>
            </Select>
            <div className={styles.fieldFull}>
              <Select
                id="course-teacher-reassign"
              label={l.assignedTeacher}
                value={form.teacher_id}
                onChange={e => setForm(f => ({ ...f, teacher_id: e.target.value }))}
                error={fieldErrors.teacher_id}
              >
                {teachers.map(t => (
                  <option key={t.id} value={t.id}>{t.full_name} ({t.email})</option>
                ))}
              </Select>
            </div>
          </div>
          <FormAlert message={saveError} />
          <div className={styles.editFooter}>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>{l.cancel}</Button>
            <Button size="sm" onClick={handleSave} loading={saving}>{l.saveChanges}</Button>
          </div>
        </div>
      ) : (
        <div className={`panel ${styles.summaryCard}`}>
          <div className={styles.summaryGrid}>
            <div>
              <div className={styles.summaryLabel}>{l.level}</div>
              <Badge variant="purple">{course.level?.name || '—'}</Badge>
            </div>
            <div>
              <div className={styles.summaryLabel}>{l.subject}</div>
              <Badge variant="accent">{course.matiere?.name || '—'}</Badge>
            </div>
            <div>
              <div className={styles.summaryLabel}>{l.teacher}</div>
              <div className={styles.summaryValue}>{teacher?.full_name ?? '—'}</div>
            </div>
            <div>
              <div className={styles.summaryLabel}>{l.created}</div>
              <div className={styles.summaryValue}>
                {new Date(course.created_at).toLocaleDateString('fr-DZ', { dateStyle: 'long' })}
              </div>
            </div>
          </div>
        </div>
      )}

      <SectionHeader title={l.sessionsForCourse} />
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{l.title}</th>
              <th>{l.status}</th>
              <th>{l.started}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sessions.length === 0 ? (
              <tr>
                <td colSpan={4} className={styles.emptyCell}>
                  <EmptyState
                    icon={Video}
                    title={l.noSessions}
                    description={l.sessionsDesc}
                  />
                </td>
              </tr>
            ) : (
              sessions.map((s, i) => (
                <tr key={s.id} className={styles.row} style={{ animationDelay: `${i * 35}ms` }}>
                  <td className={styles.sessionTitle}>{s.title}</td>
                  <td><StatusBadge status={s.status} locale={locale} /></td>
                  <td className={styles.date}>
                    {s.started_at
                      ? new Date(s.started_at).toLocaleString('fr-DZ', { dateStyle: 'short', timeStyle: 'short' })
                      : '—'}
                  </td>
                  <td className={styles.actionCell}>
                    {s.status === 'done' && (
                      <Link href={`/admin/sessions/${s.id}`} className={styles.viewBtn}>{isRTL ? `\u2190 ${l.outline}` : `${l.outline} \u2192`}</Link>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
