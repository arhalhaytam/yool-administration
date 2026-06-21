'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Video, ArrowRight, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import type { Session, Course } from '@/lib/types';
import Badge from '@/components/ui/Badge';
import Pagination from '@/components/ui/Pagination';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import ResponsiveTable, { type TableColumn } from '@/components/ui/ResponsiveTable';
import { LIST_PAGE_SIZE } from '@/lib/pagination';
import FormAlert from '@/components/ui/FormAlert';
import { getErrorMessage } from '@/lib/errors';
import { useLocale, useT } from '@/lib/i18n/LanguageContext';
import { useApiErrors } from '@/lib/i18n/useApiErrors';
import Select from '@/components/ui/Select';
import styles from './page.module.css';

type BadgeVariant = 'success' | 'warning' | 'danger' | 'default' | 'accent';

function StatusBadge({ status }: { status: Session['status'] }) {
  const t = useT();
  const map: Record<string, { v: BadgeVariant; sKey: string; dot?: boolean }> = {
    done:       { v: 'success', sKey: 'session.status.done'       },
    processing: { v: 'warning', sKey: 'session.status.processing' },
    live:       { v: 'danger',  sKey: 'session.status.live', dot: true },
    failed:     { v: 'default', sKey: 'session.status.failed'     },
    created:    { v: 'accent',  sKey: 'session.status.created'    },
  };
  const cfg = map[status] ?? map.created;
  return <Badge variant={cfg.v} dot={!!cfg.dot} pulse={!!cfg.dot}>{t(cfg.sKey)}</Badge>;
}

function fmt(iso: string | null, locale: 'en' | 'fr' | 'ar') {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(
    locale === 'fr' ? 'fr-DZ' : locale === 'ar' ? 'ar-DZ' : 'en-US',
    { dateStyle: 'short', timeStyle: 'short' },
  );
}

export default function TeacherSessionsPage() {
  const t = useT();
  const { locale, isRTL } = useLocale();
  const apiErrors = useApiErrors();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseFilter, setCourseFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [coursesLoadError, setCoursesLoadError] = useState('');
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const load = useCallback(async (pageOffset: number, courseId: string) => {
    setLoading(true);
    setLoadError('');
    try {
      const page = await api.sessions.list({
        limit: LIST_PAGE_SIZE,
        offset: pageOffset,
        course_id: courseId || undefined,
      });
      setSessions(page.items);
      setTotal(page.total);
      setOffset(page.offset);
    } catch (err) {
      setSessions([]);
      setTotal(0);
      setLoadError(getErrorMessage(err, t('common.error'), apiErrors));
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setCoursesLoadError('');
    api.courses.list({ assigned_to_me: true, limit: 200 })
      .then(p => {
        setCourses(p.items);
        setCoursesLoadError('');
      })
      .catch((err) => {
        setCourses([]);
        setCoursesLoadError(getErrorMessage(err, t('common.error'), apiErrors));
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load(0, courseFilter);
  }, [courseFilter, load]);

  const getCourse = (cid: string) => courses.find(c => c.id === cid);

  const handleCancel = useCallback(async (sessionId: string) => {
    const msg = locale === 'fr'
      ? 'Confirmer l\'annulation de cette séance ?'
      : locale === 'ar'
      ? 'تأكيد إلغاء هذه الجلسة؟'
      : 'Cancel this session?';
    if (!window.confirm(msg)) return;
    setCancellingId(sessionId);
    try {
      await api.sessions.cancel(sessionId);
      await load(offset, courseFilter);
    } catch (err) {
      setLoadError(getErrorMessage(err, t('common.error'), apiErrors));
    } finally {
      setCancellingId(null);
    }
  }, [locale, load, offset, courseFilter, t, apiErrors]); // eslint-disable-line react-hooks/exhaustive-deps

  const courseSelect = (
    <div className={styles.filterWrap}>
      <Select
        className={styles.filterSelect}
        value={courseFilter}
        onChange={e => {
          setCourseFilter(e.target.value);
          setOffset(0);
        }}
        aria-label={t('course.filterBySubject')}
      >
        <option value="">{t('common.all')}</option>
        {courses.map(c => {
          const title = `${c.matiere?.name || t('course.subject')} - ${c.level?.name || t('course.level')}`;
          return (
            <option key={c.id} value={c.id}>{title}</option>
          );
        })}
      </Select>
    </div>
  );

  const columns: TableColumn<Session>[] = useMemo(() => [
    {
      id: 'title',
      header: t('session.title'),
      primary: true,
      cell: s => <span className={styles.titleCell}>{s.title}</span>,
    },
    {
      id: 'status',
      header: locale === 'ar' ? 'الحالة' : locale === 'fr' ? 'Statut' : 'Status',
      cell: s => <StatusBadge status={s.status} />,
    },
    {
      id: 'course',
      header: t('course.title'),
      hideOnMobile: true,
      cell: s => {
        const course = getCourse(s.course_id);
        return (
          <span className={styles.courseCell}>
            {course ? `${course.matiere?.name || t('course.subject')} - ${course.level?.name || t('course.level')}` : '—'}
          </span>
        );
      },
    },
    {
      id: 'duration',
      header: t('session.duration'),
      cell: s => {
        const d = s.started_at && s.ended_at
          ? Math.round((new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 60000)
          : null;
        return <span className={styles.date}>{d != null ? `${d} ${t('common.min')}` : '—'}</span>;
      },
    },
    {
      id: 'recorded',
      header: t('session.recordedAt'),
      hideOnMobile: true,
      cell: s => <span className={styles.date}>{fmt(s.started_at, locale)}</span>,
    },
    {
      id: 'actions',
      header: '',
      align: 'end',
      unlabeledOnMobile: true,
      cell: s => {
        if (s.status === 'done')       return <Link href={`/teacher/sessions/${s.id}`} className={styles.viewBtn}>{t('common.actions')} {isRTL ? <span className={styles.arrowRtl}><ArrowRight size={13} strokeWidth={2} /></span> : <ArrowRight size={13} strokeWidth={2} />}</Link>;
        if (s.status === 'live')       return <Link href={`/teacher/record/${s.id}`}   className={styles.viewBtn}>{t('record.recording')} {isRTL ? <span className={styles.arrowRtl}><ArrowRight size={13} strokeWidth={2} /></span> : <ArrowRight size={13} strokeWidth={2} />}</Link>;
        if (s.status === 'processing') return <Link href={`/teacher/sessions/${s.id}`} className={styles.processing}>{t('session.status.processing')}…</Link>;
        if (s.status === 'failed')     return <Link href={`/teacher/sessions/${s.id}`} className={styles.viewBtnDanger}>{t('common.actions')} {isRTL ? <span className={styles.arrowRtl}><ArrowRight size={13} strokeWidth={2} /></span> : <ArrowRight size={13} strokeWidth={2} />}</Link>;
        if (s.status === 'created')    return (
          <button
            type="button"
            className={styles.cancelBtn}
            onClick={() => handleCancel(s.id)}
            disabled={cancellingId === s.id}
          >
            <XCircle size={12} />
            {cancellingId === s.id ? '…' : t('common.cancel')}
          </button>
        );
        return null;
      },
    },
  ], [t, courses, locale, isRTL, handleCancel, cancellingId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <PageHeader
        title={t('session.mySessions')}
        subtitle={loading && offset === 0 ? '…' : `${total} ${t('common.sessions')}`}
        border
        action={courseSelect}
      />

      {loadError && <FormAlert message={loadError} className={styles.pageAlert} />}
      {coursesLoadError && (
        <FormAlert variant="warning" message={coursesLoadError} className={styles.pageAlert} />
      )}

      <ResponsiveTable<Session>
        columns={columns}
        data={sessions}
        getRowKey={s => s.id}
        loading={loading}
        loadingRows={8}
        emptyState={
          <EmptyState
            icon={Video}
            title={t('session.noSessions')}
            description={t('session.noSessionsDesc')}
          />
        }
      />

      <Pagination
        offset={offset}
        pageSize={LIST_PAGE_SIZE}
        total={total}
        loading={loading}
        itemLabel={t('common.sessions')}
        onPageChange={next => load(next, courseFilter)}
      />
    </div>
  );
}
