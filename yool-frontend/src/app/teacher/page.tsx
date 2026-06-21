'use client';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  ArrowRight, GraduationCap, LayoutList, Timer, CheckCircle2,
  AlertCircle, Target, Radio, Clock, CalendarDays, CalendarCheck,
  Gauge, BarChart3, TrendingUp, TrendingDown,
} from 'lucide-react';
import { api } from '@/lib/api';
import type {
  Session, SessionStatusSummary, SessionStatsOverview,
} from '@/lib/types';
import PageHeader from '@/components/ui/PageHeader';
import SectionHeader from '@/components/ui/SectionHeader';
import EmptyState from '@/components/ui/EmptyState';
import Badge from '@/components/ui/Badge';
import FormAlert from '@/components/ui/FormAlert';
import { getErrorMessage } from '@/lib/errors';
import { useLocale, useT } from '@/lib/i18n/LanguageContext';
import { useApiErrors } from '@/lib/i18n/useApiErrors';
import styles from './page.module.css';

// Cell must be a static import — see admin/page.tsx for explanation.
import { Cell } from 'recharts';

const AreaChart           = dynamic(() => import('recharts').then(m => m.AreaChart),           { ssr: false });
const Area                = dynamic(() => import('recharts').then(m => m.Area),                { ssr: false });
const PieChart            = dynamic(() => import('recharts').then(m => m.PieChart),            { ssr: false });
const Pie                 = dynamic(() => import('recharts').then(m => m.Pie),                 { ssr: false });
const Tooltip             = dynamic(() => import('recharts').then(m => m.Tooltip),             { ssr: false });
const ResponsiveContainer = dynamic(() => import('recharts').then(m => m.ResponsiveContainer), { ssr: false });
const XAxis               = dynamic(() => import('recharts').then(m => m.XAxis),               { ssr: false });
const YAxis               = dynamic(() => import('recharts').then(m => m.YAxis),               { ssr: false });
const CartesianGrid       = dynamic(() => import('recharts').then(m => m.CartesianGrid),       { ssr: false });
const ReferenceLine       = dynamic(() => import('recharts').then(m => m.ReferenceLine),       { ssr: false });

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

function buildChartData(sessions: Session[], locale: 'en' | 'fr' | 'ar') {
  const days: Record<string, number> = {};
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days[d.toISOString().slice(0, 10)] = 0;
  }
  sessions.forEach(s => {
    if (!s.started_at) return;
    const day = s.started_at.slice(0, 10);
    if (day in days) days[day]++;
  });
  return Object.entries(days).map(([date, count]) => ({
    date: new Date(date).toLocaleDateString(
      locale === 'fr' ? 'fr-DZ' : locale === 'ar' ? 'ar-DZ' : 'en-US',
      { month: 'short', day: 'numeric' },
    ),
    sessions: count,
  }));
}

const C = {
  success: '#22c55e',
  danger:  '#f43f5e',
  warning: '#f59e0b',
  accent:  '#5b78ff',
  cyan:    '#22d3ee',
} as const;

function fmtHours(minutes: number, locale: 'en' | 'fr' | 'ar'): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return locale === 'ar' ? `${m}د` : `${m}m`;
  if (m === 0) return locale === 'ar' ? `${h}س` : `${h}h`;
  return locale === 'ar' ? `${h}س ${m}د` : `${h}h ${m}m`;
}

function fmtDate(iso: string | null, locale: 'en' | 'fr' | 'ar'): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(
    locale === 'fr' ? 'fr-DZ' : locale === 'ar' ? 'ar-DZ' : 'en-US',
    { dateStyle: 'short' },
  );
}

export default function TeacherDashboard() {
  const t = useT();
  const { locale, isRTL } = useLocale();
  const apiErrors = useApiErrors();

  const [coursesTotal, setCoursesTotal]   = useState(0);
  const [chartSessions, setChartSessions] = useState<Session[]>([]);
  const [summary, setSummary]             = useState<SessionStatusSummary | null>(null);
  const [overview, setOverview]           = useState<SessionStatsOverview | null>(null);
  const [loading, setLoading]             = useState(true);
  const [loadError, setLoadError]         = useState('');

  const l = {
    en: {
      dashboardTitle:    'Dashboard',
      dashboardSub:      'Your teaching activity at a glance',
      myCourses:         'My Courses',
      totalSessions:     'Total Sessions',
      hoursLabel:        'Hours Recorded',
      avgScore:          'Avg. Context Score',
      done:              'Done',
      failed:            'Failed',
      processing:        'Processing',
      liveNow:           'Live Now',
      thisWeek:          'This Week',
      thisMonth:         'This Month',
      completionRate:    'Completion Rate',
      trendTitle:        'My session activity',
      trendSub:          'Last 14 days',
      avgLine:           'Daily avg.',
      outcomesTitle:     'Session outcomes',
      outcomesSub:       'All-time status breakdown',
      noDataTitle:       'No data yet',
      noDataDesc:        'Outcomes will appear after your first finalized session.',
      totalLabel:        'total',
      recentSessions:    'Recent sessions',
      recentSub:         'Last 5 sessions',
      noRecent:          'No sessions yet',
      noRecentDesc:      'Start your first session from a course chapter.',
      viewAll:           'View all',
      liveSessionActive:   'You have a live session in progress',
      resumeRecording:     'Resume recording',
      adherenceTitle:      'Session adherence',
      adherenceSub:        'Curriculum coverage — your completed sessions',
      inContext:           'In context',
      outContext:          'Out of context',
      sessionsInContext:   'Sessions in context',
      sessionsOutContext:  'Sessions out of context',
      ofTotal:             'of total',
      noAdherenceTitle:    'No adherence data yet',
      noAdherenceDesc:     'Adherence will appear after your first completed session.',
    },
    fr: {
      dashboardTitle:    'Tableau de bord',
      dashboardSub:      "Votre activité d'enseignement en un coup d'œil",
      myCourses:         'Mes cours',
      totalSessions:     'Total séances',
      hoursLabel:        'Heures enregistrées',
      avgScore:          'Score de contexte moyen',
      done:              'Terminées',
      failed:            'Échouées',
      processing:        'En traitement',
      liveNow:           'En direct',
      thisWeek:          'Cette semaine',
      thisMonth:         'Ce mois',
      completionRate:    'Taux de complétion',
      trendTitle:        'Mon activité de séances',
      trendSub:          '14 derniers jours',
      avgLine:           'Moy. quotidienne',
      outcomesTitle:     'Résultats des séances',
      outcomesSub:       'Répartition des statuts (depuis le début)',
      noDataTitle:       'Aucune donnée',
      noDataDesc:        'Les résultats apparaîtront après votre première séance finalisée.',
      totalLabel:        'total',
      recentSessions:    'Séances récentes',
      recentSub:         'Les 5 dernières séances',
      noRecent:          "Aucune séance pour l'instant",
      noRecentDesc:      'Démarrez votre première séance depuis un chapitre.',
      viewAll:           'Voir tout',
      liveSessionActive:   'Vous avez une séance en cours',
      resumeRecording:     "Reprendre l'enregistrement",
      adherenceTitle:      'Adhérence des séances',
      adherenceSub:        'Couverture du programme — vos séances terminées',
      inContext:           'En contexte',
      outContext:          'Hors contexte',
      sessionsInContext:   'Séances en contexte',
      sessionsOutContext:  'Séances hors contexte',
      ofTotal:             'du total',
      noAdherenceTitle:    'Aucune donnée d\'adhérence',
      noAdherenceDesc:     'L\'adhérence apparaîtra après votre première séance terminée.',
    },
    ar: {
      dashboardTitle:    'لوحة القيادة',
      dashboardSub:      'نشاط التدريس الخاص بك دفعة واحدة',
      myCourses:         'دروسي',
      totalSessions:     'إجمالي الجلسات',
      hoursLabel:        'ساعات مسجّلة',
      avgScore:          'متوسط نتيجة السياق',
      done:              'منتهية',
      failed:            'فاشلة',
      processing:        'قيد المعالجة',
      liveNow:           'مباشر الآن',
      thisWeek:          'هذا الأسبوع',
      thisMonth:         'هذا الشهر',
      completionRate:    'معدل الإنجاز',
      trendTitle:        'نشاط جلساتي',
      trendSub:          'آخر 14 يوماً',
      avgLine:           'المتوسط اليومي',
      outcomesTitle:     'نتائج الجلسات',
      outcomesSub:       'توزيع الحالات (كل الوقت)',
      noDataTitle:       'لا توجد بيانات بعد',
      noDataDesc:        'ستظهر النتائج بعد إنهاء جلستك الأولى.',
      totalLabel:        'إجمالي',
      recentSessions:    'الجلسات الأخيرة',
      recentSub:         'آخر 5 جلسات',
      noRecent:          'لا توجد جلسات بعد',
      noRecentDesc:      'ابدأ جلستك الأولى من فصل دراسي.',
      viewAll:           'عرض الكل',
      liveSessionActive:   'لديك جلسة مباشرة جارية',
      resumeRecording:     'استئناف التسجيل',
      adherenceTitle:      'الالتزام بالجلسات',
      adherenceSub:        'تغطية المنهج — جلساتك المكتملة',
      inContext:           'ضمن السياق',
      outContext:          'خارج السياق',
      sessionsInContext:   'جلسات ضمن السياق',
      sessionsOutContext:  'جلسات خارج السياق',
      ofTotal:             'من الإجمالي',
      noAdherenceTitle:    'لا توجد بيانات التزام بعد',
      noAdherenceDesc:     'ستظهر البيانات بعد اكتمال أول جلسة.',
    },
  }[locale];

  useEffect(() => {
    const safe = <T,>(p: Promise<T>, fallback: T): Promise<T> =>
      p.catch(() => fallback);

    Promise.all([
      api.courses.list({ assigned_to_me: true, limit: 1 })
        .then(p => p.total)
        .catch((err) => {
          setLoadError(getErrorMessage(err, t('common.error'), apiErrors));
          return 0;
        }),
      safe(api.sessions.list({ limit: 200 }), { items: [], total: 0, limit: 200, offset: 0, has_more: false }),
      safe(api.sessions.statusSummary(), null as SessionStatusSummary | null),
      safe(api.sessions.statsOverview(),  null as SessionStatsOverview | null),
    ]).then(([total, chartPage, statusSum, overviewStats]) => {
      setCoursesTotal(total);
      setChartSessions(chartPage.items);
      setSummary(statusSum);
      setOverview(overviewStats);
    }).finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived ────────────────────────────────────────────────────────────────
  const avgScore = overview?.avg_context_score ?? null;
  const scoreColor = avgScore !== null
    ? avgScore >= 0.8 ? 'var(--success)' : avgScore >= 0.6 ? 'var(--warning)' : 'var(--danger)'
    : 'var(--muted)';

  const completedTotal = (summary?.done ?? 0) + (summary?.failed ?? 0);
  const completionRate = completedTotal > 0
    ? Math.round((summary?.done ?? 0) / completedTotal * 100)
    : null;

  const recentSessions = overview?.recent_sessions ?? [];
  const liveSession = recentSessions.find(s => s.status === 'live') ?? null;

  // ── Adherence (in-context vs out-of-context) ───────────────────────────────
  const inCtx    = overview?.in_context    ?? 0;
  const outCtx   = overview?.out_of_context ?? 0;
  const totalCtx = inCtx + outCtx;
  const inPct    = totalCtx > 0 ? Math.round((inCtx  / totalCtx) * 100) : 0;
  const outPct   = totalCtx > 0 ? Math.round((outCtx / totalCtx) * 100) : 0;
  const adherencePieData = [
    { name: l.inContext,  value: inCtx,  color: C.success },
    { name: l.outContext, value: outCtx, color: C.danger  },
  ].filter(d => d.value > 0);

  // ── Chart data ─────────────────────────────────────────────────────────────
  const chartData = buildChartData(chartSessions, locale);
  const chartAvg  = chartData.length > 0
    ? Math.round(chartData.reduce((s, d) => s + d.sessions, 0) / chartData.length)
    : 0;

  // ── Session outcomes ───────────────────────────────────────────────────────
  const outcomeData = [
    { name: t('session.status.done'),       value: summary?.done ?? 0,       color: C.success },
    { name: t('session.status.failed'),     value: summary?.failed ?? 0,     color: C.danger  },
    { name: t('session.status.processing'), value: summary?.processing ?? 0, color: C.warning },
    { name: t('session.status.created'),    value: summary?.created ?? 0,    color: C.accent  },
    { name: t('session.status.live'),       value: summary?.live ?? 0,       color: C.cyan    },
  ].filter(d => d.value > 0);
  const outcomeTotal = outcomeData.reduce((s, d) => s + d.value, 0);

  // ── KPI definitions (2 rows of 4) ─────────────────────────────────────────
  const liveCount      = summary?.live ?? 0;
  const failedCount    = summary?.failed ?? 0;
  const processingCount = summary?.processing ?? 0;

  const allKpis = [
    { label: l.myCourses,     value: loading ? null : coursesTotal,                             icon: GraduationCap, color: 'var(--accent)',  bg: 'var(--accent-dim)'  },
    { label: l.totalSessions, value: summary?.total ?? null,                                    icon: LayoutList,    color: 'var(--purple)',  bg: 'var(--purple-dim)'  },
    { label: l.hoursLabel,    value: overview ? fmtHours(overview.total_hours_minutes, locale) : null, icon: Timer, color: 'var(--cyan)',    bg: 'var(--cyan-dim)'    },
    { label: l.avgScore,      value: avgScore !== null ? `${Math.round(avgScore * 100)}%` : null, icon: Target,      color: scoreColor,       bg: 'var(--surface-2)'   },
    { label: l.done,          value: summary?.done ?? null,                                     icon: CheckCircle2,  color: 'var(--success)', bg: 'var(--success-dim)' },
    { label: l.failed,        value: failedCount,                                               icon: AlertCircle,   color: failedCount > 0 ? 'var(--danger)' : 'var(--muted)',         bg: failedCount > 0 ? 'var(--danger-dim)' : 'var(--surface-2)'  },
    { label: l.processing,    value: processingCount,                                           icon: Clock,         color: processingCount > 0 ? 'var(--warning)' : 'var(--muted)',    bg: processingCount > 0 ? 'var(--warning-dim)' : 'var(--surface-2)' },
    { label: l.liveNow,       value: liveCount,                                                 icon: Radio,         color: liveCount > 0 ? 'var(--danger)' : 'var(--muted)',           bg: liveCount > 0 ? 'var(--danger-dim)' : 'var(--surface-2)', pulse: liveCount > 0 },
  ];

  // ── Chips ──────────────────────────────────────────────────────────────────
  const chips = [
    { label: l.thisWeek,      value: overview?.sessions_this_week  ?? null, icon: CalendarDays,  color: 'var(--text-2)' },
    { label: l.thisMonth,     value: overview?.sessions_this_month ?? null, icon: CalendarCheck, color: 'var(--text-2)' },
    { label: l.completionRate, value: completionRate !== null ? `${completionRate}%` : null, icon: Gauge,
      color: completionRate === null ? 'var(--muted)' : completionRate >= 90 ? 'var(--success)' : completionRate >= 70 ? 'var(--warning)' : 'var(--danger)',
    },
  ];

  // ── Tooltip components ─────────────────────────────────────────────────────
  function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
    if (!active || !payload?.length) return null;
    return (
      <div className={styles.chartTooltip}>
        <p className={styles.chartTooltipLabel}>{label}</p>
        <p className={styles.chartTooltipValue}>{payload[0].value} {t('common.sessions')}</p>
      </div>
    );
  }

  function OutcomeTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { name: string; value: number } }> }) {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    const pct = outcomeTotal > 0 ? Math.round((d.value / outcomeTotal) * 100) : 0;
    return (
      <div className={styles.chartTooltip}>
        <p className={styles.chartTooltipLabel}>{d.name}</p>
        <p className={styles.chartTooltipValue}>{d.value} {t('common.sessions')} ({pct}%)</p>
      </div>
    );
  }

  function AdherenceTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { name: string; value: number } }> }) {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    const pct = totalCtx > 0 ? Math.round((d.value / totalCtx) * 100) : 0;
    return (
      <div className={styles.chartTooltip}>
        <p className={styles.chartTooltipLabel}>{d.name}</p>
        <p className={styles.chartTooltipValue}>{d.value} {t('common.sessions')} ({pct}%)</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={l.dashboardTitle} subtitle={l.dashboardSub} border />

      {loadError && <FormAlert message={loadError} className={styles.pageAlert} />}

      {/* ── 8 KPI cards (2 × 4 grid) ────────────────────────────── */}
      <div className={styles.kpiGrid}>
        {allKpis.map((kpi, i) => {
          const Icon = kpi.icon;
          return (
            <div
              key={kpi.label}
              className={[styles.kpiCard, 'pulse' in kpi && kpi.pulse ? styles.kpiCardLive : ''].join(' ')}
              style={{
                '--kpi-delay': `${i * 45}ms`,
                '--kpi-color': kpi.color,
                '--kpi-bg':    kpi.bg,
              } as React.CSSProperties}
            >
              <div className={styles.kpiIcon}>
                <Icon size={17} strokeWidth={2} />
              </div>
              <div className={styles.kpiBody}>
                <div className={styles.kpiValue}>
                  {loading ? <span className={styles.kpiSkeleton} /> : (kpi.value ?? '—')}
                </div>
                <div className={styles.kpiLabel}>{kpi.label}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Chips ────────────────────────────────────────────────── */}
      <div className={styles.chipRow}>
        {chips.map((chip, i) => {
          const Icon = chip.icon;
          return (
            <div
              key={chip.label}
              className={styles.chip}
              style={{
                '--chip-delay': `${i * 50 + 400}ms`,
                '--chip-color': chip.color,
              } as React.CSSProperties}
            >
              <Icon size={13} className={styles.chipIcon} />
              <span className={styles.chipValue}>
                {loading
                  ? <span className={`${styles.skeleton} ${styles.chipSkeleton}`} />
                  : (chip.value ?? '—')}
              </span>
              <span className={styles.chipLabel}>{chip.label}</span>
            </div>
          );
        })}
      </div>

      {/* ── Charts row: trend + outcomes ─────────────────────────── */}
      <div className={styles.chartsRow}>

        {/* Sessions trend area chart */}
        <div className={styles.chartCard}>
          <SectionHeader title={l.trendTitle} subtitle={l.trendSub} />
          <div className={styles.chartWrap}>
            {loading ? (
              <div className={styles.chartSkeleton} />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={chartData} margin={{ top: 10, right: 12, bottom: 0, left: -20 }}>
                  <defs>
                    <linearGradient id="teacherGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor="var(--accent)" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="var(--accent)" stopOpacity={0}   />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="4 2" stroke="var(--border)" opacity={0.6} vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: 'var(--muted)', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fill: 'var(--muted)', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip content={(props) => <ChartTooltip {...(props as unknown as Parameters<typeof ChartTooltip>[0])} />} cursor={{ stroke: 'var(--border-2)', strokeDasharray: '4 2' }} />
                  {chartAvg > 0 && (
                    <ReferenceLine
                      y={chartAvg}
                      stroke="var(--accent)"
                      strokeDasharray="5 3"
                      strokeOpacity={0.5}
                      label={{ value: `${l.avgLine}: ${chartAvg}`, position: 'insideTopRight', fill: 'var(--muted)', fontSize: 10 }}
                    />
                  )}
                  <Area
                    type="monotone"
                    dataKey="sessions"
                    stroke="var(--accent)"
                    strokeWidth={2.5}
                    fill="url(#teacherGrad)"
                    dot={false}
                    activeDot={{ r: 5, fill: 'var(--accent)', stroke: 'var(--bg)', strokeWidth: 2.5 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Session outcomes donut */}
        <div className={styles.chartCard}>
          <SectionHeader title={l.outcomesTitle} subtitle={l.outcomesSub} />
          {loading ? (
            <div className={styles.contextSkeleton}>
              <div className={`${styles.chartSkeleton} ${styles.chartSkeletonShort}`} />
        </div>
          ) : outcomeTotal === 0 ? (
            <EmptyState icon={BarChart3} title={l.noDataTitle} description={l.noDataDesc} />
          ) : (
            <div className={styles.outcomeBody}>
              <div className={styles.donutWrap}>
                <ResponsiveContainer width="100%" height={190}>
                  <PieChart>
                    <Pie
                      data={outcomeData}
                      cx="50%" cy="50%"
                      innerRadius={55} outerRadius={80}
                      paddingAngle={2}
                      dataKey="value"
                      strokeWidth={0}
                      startAngle={90}
                      endAngle={-270}
                    >
                      {outcomeData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} opacity={0.9} />
                      ))}
                    </Pie>
                    <Tooltip content={(props) => <OutcomeTooltip {...(props as unknown as Parameters<typeof OutcomeTooltip>[0])} />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className={styles.donutCenter}>
                  <span className={styles.donutPct}>{outcomeTotal}</span>
                  <span className={styles.donutLabel}>{l.totalLabel}</span>
                </div>
              </div>
              <ul className={styles.outcomeLegend}>
                {outcomeData.map(d => {
                  const pct = Math.round((d.value / outcomeTotal) * 100);
                  return (
                    <li key={d.name} className={styles.outcomeLegendItem}>
                      <span className={styles.outcomeDot} style={{ '--dot-color': d.color } as React.CSSProperties} />
                      <span className={styles.outcomeName}>{d.name}</span>
                      <span className={styles.outcomeCount}>{d.value}</span>
                      <span className={styles.outcomePct}>{pct}%</span>
                    </li>
            );
          })}
              </ul>
            </div>
          )}
        </div>

      </div>

      {/* ── Live session banner ──────────────────────────────────── */}
      {!loading && liveSession && (
        <Link href={`/teacher/record/${liveSession.id}`} className={styles.liveBanner}>
          <div className={styles.liveBannerLeft}>
            <span className={styles.liveDot} />
            <Radio size={15} />
            <span>{l.liveSessionActive}</span>
            <span className={styles.liveTitle}>{liveSession.title}</span>
          </div>
          <div className={styles.liveBannerBtn}>
            {l.resumeRecording}
            <ArrowRight size={13} style={isRTL ? { transform: 'rotate(180deg)' } : undefined} />
          </div>
        </Link>
      )}

      {/* ── Session adherence (in-context vs out-of-context) ───────── */}
      <div className={styles.chartCard}>
        <SectionHeader title={l.adherenceTitle} subtitle={l.adherenceSub} />

        {loading ? (
          <div className={styles.contextSkeleton}>
            <div className={`${styles.chartSkeleton} ${styles.chartSkeletonShort}`} />
          </div>
        ) : totalCtx === 0 ? (
          <EmptyState icon={BarChart3} title={l.noAdherenceTitle} description={l.noAdherenceDesc} />
        ) : (
          <div className={styles.contextBody}>

            <div className={styles.donutWrap}>
              <ResponsiveContainer width="100%" height={230}>
                <PieChart>
                  <Pie
                    data={adherencePieData}
                    cx="50%" cy="50%"
                    innerRadius={65} outerRadius={96}
                    paddingAngle={3}
                    dataKey="value"
                    strokeWidth={0}
                    startAngle={90}
                    endAngle={-270}
                  >
                    {adherencePieData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} opacity={0.92} />
                    ))}
                  </Pie>
                  <Tooltip content={(props) => <AdherenceTooltip {...(props as unknown as Parameters<typeof AdherenceTooltip>[0])} />} />
                </PieChart>
              </ResponsiveContainer>
              <div className={styles.donutCenter}>
                <span
                  className={styles.donutPct}
                  style={{
                    color: inPct >= 80 ? C.success : inPct >= 60 ? C.warning : C.danger,
                  }}
                >
                  {inPct}%
                </span>
                <span className={styles.donutLabel}>{l.inContext}</span>
              </div>
            </div>

            <div className={styles.contextLegend}>
              <div className={styles.contextStat}>
                <div className={styles.contextStatIcon} data-variant="success">
                  <TrendingUp size={16} strokeWidth={2} />
                </div>
                <div>
                  <div className={styles.contextStatValue} data-variant="success">{inCtx}</div>
                  <div className={styles.contextStatLabel}>{l.sessionsInContext}</div>
                  <div className={styles.contextStatPct}>{inPct}% {l.ofTotal}</div>
                </div>
              </div>
              <div className={styles.contextDivider} />
              <div className={styles.contextStat}>
                <div className={styles.contextStatIcon} data-variant="danger">
                  <TrendingDown size={16} strokeWidth={2} />
                </div>
                <div>
                  <div className={styles.contextStatValue} data-variant="danger">{outCtx}</div>
                  <div className={styles.contextStatLabel}>{l.sessionsOutContext}</div>
                  <div className={styles.contextStatPct}>{outPct}% {l.ofTotal}</div>
                </div>
              </div>
              <div className={styles.contextBar}>
                <div
                  className={styles.contextBarFill}
                  style={{ '--bar-w': `${inPct}%` } as React.CSSProperties}
                />
              </div>
              <div className={styles.contextBarLabels}>
                <span className={styles.contextBarLabelIn}>{l.inContext}</span>
                <span className={styles.contextBarLabelOut}>{l.outContext}</span>
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
