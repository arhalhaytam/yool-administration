'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Video, ArrowRight } from 'lucide-react';
import { api } from '@/lib/api';
import type { Session, SessionStatus, SessionStatusSummary } from '@/lib/types';
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
import styles from './page.module.css';

const FILTERS = ['all', 'live', 'done', 'processing', 'failed'] as const;

type BadgeVariant = 'success' | 'warning' | 'danger' | 'default' | 'accent';

function StatusBadge({ status }: { status: Session['status'] }) {
  const t = useT();
  const map: Record<string, { v: BadgeVariant; dot?: boolean }> = {
    done:       { v: 'success' },
    processing: { v: 'warning' },
    live:       { v: 'danger', dot: true },
    failed:     { v: 'default' },
    created:    { v: 'accent' },
  };
  const cfg = map[status] ?? map.created;
  const label = t(`session.status.${status}`) || status;
  return <Badge variant={cfg.v} dot={!!cfg.dot} pulse={!!cfg.dot}>{label}</Badge>;
}

function fmt(iso: string | null, locale: 'en' | 'fr' | 'ar') {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(
    locale === 'fr' ? 'fr-DZ' : locale === 'ar' ? 'ar-DZ' : 'en-US',
    { dateStyle: 'short', timeStyle: 'short' },
  );
}

function filterCount(summary: SessionStatusSummary | null, f: string): number {
  if (!summary) return 0;
  if (f === 'all') return summary.total;
  if (f === 'live') return summary.live;
  if (f === 'done') return summary.done;
  if (f === 'processing') return summary.processing;
  if (f === 'failed') return summary.failed;
  return 0;
}

export default function AdminSessionsPage() {
  const t = useT();
  const { locale, isRTL } = useLocale();
  const apiErrors = useApiErrors();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [summary, setSummary] = useState<SessionStatusSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async (pageOffset: number, statusFilter: string) => {
    setLoading(true);
    setLoadError('');
    const status =
      statusFilter === 'all' ? undefined : (statusFilter as SessionStatus);
    try {
      const requests: [
        ReturnType<typeof api.sessions.list>,
        Promise<SessionStatusSummary | null>,
      ] = [
        api.sessions.list({ limit: LIST_PAGE_SIZE, offset: pageOffset, status }),
        pageOffset === 0 ? api.sessions.statusSummary() : Promise.resolve(null),
      ];
      const [page, sum] = await Promise.all(requests);
      setSessions(page.items);
      setTotal(page.total);
      setOffset(page.offset);
      if (sum) setSummary(sum);
    } catch (err) {
      setSessions([]);
      setTotal(0);
      setLoadError(getErrorMessage(err, t('common.error'), apiErrors));
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load(0, filter);
  }, [filter, load]);

  function changeFilter(f: string) {
    setFilter(f);
    setOffset(0);
  }

  const filterPills = (
    <div className={styles.filters}>
      {FILTERS.map(f => (
        <button
          key={f}
          type="button"
          onClick={() => changeFilter(f)}
          className={['ui-pill', styles.filterBtn, filter === f ? 'is-active' : ''].join(' ')}
        >
          {f === 'all' ? t('common.all') : t(`session.status.${f}`) || f}
          <span className={`ui-pill-count ${styles.filterCount}`}>{filterCount(summary, f)}</span>
        </button>
      ))}
    </div>
  );

  const columns: TableColumn<Session>[] = useMemo(() => [
    {
      id: 'title',
      header: t('session.title'),
      primary: true,
      cell: s => <span className={styles.sessionTitle}>{s.title}</span>,
    },
    {
      id: 'status',
      header: locale === 'ar' ? 'الحالة' : locale === 'fr' ? 'Statut' : 'Status',
      cell: s => <StatusBadge status={s.status} />,
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
      cell: s => s.status === 'done' ? (
        <Link href={`/admin/sessions/${s.id}`} className={styles.viewBtn}>
          {t('common.actions')} {isRTL ? <span className={styles.arrowRtl}><ArrowRight size={13} strokeWidth={2} /></span> : <ArrowRight size={13} strokeWidth={2} />}
        </Link>
      ) : null,
    },
  ], [t, locale, isRTL]);

  return (
    <div>
      <PageHeader
        title={t('session.title')}
        subtitle={loading && offset === 0 ? '…' : `${total} ${t('common.sessions')}`}
        border
        action={filterPills}
      />

      {loadError && <FormAlert message={loadError} className={styles.pageAlert} />}

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
        onPageChange={next => load(next, filter)}
      />
    </div>
  );
}
