'use client';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  BookOpen, Radio, CheckCircle2, Clock, TrendingUp, TrendingDown,
  BarChart3, AlertCircle, Users, UserCheck, MailOpen, Timer, Target,
  CalendarDays, CalendarCheck, Medal, Gauge,
} from 'lucide-react';
import { api } from '@/lib/api';
import type {
  Session, SessionStatusSummary, TeacherContextStat,
  UserRoleSummary, SessionStatsOverview,
} from '@/lib/types';
import PageHeader from '@/components/ui/PageHeader';
import SectionHeader from '@/components/ui/SectionHeader';
import EmptyState from '@/components/ui/EmptyState';
import { useLocale, useT } from '@/lib/i18n/LanguageContext';
import styles from './page.module.css';

// Cell must be a static import — Recharts' Pie identifies children by type identity
// (child.type === Cell). A next/dynamic wrapper breaks that check and silently drops fill colors.
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
  purple:  '#a78bfa',
} as const;

function fmtHours(minutes: number, locale: 'en' | 'fr' | 'ar'): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return locale === 'ar' ? `${m}د` : `${m}m`;
  if (m === 0) return locale === 'ar' ? `${h}س` : `${h}h`;
  return locale === 'ar' ? `${h}س ${m}د` : `${h}h ${m}m`;
}

export default function AdminDashboard() {
  const t = useT();
  const { locale } = useLocale();

  const l = {
    en: {
      last14:             'Last 14 days',
      avgLine:            'Daily avg.',
      adherenceTitle:     'Program adherence',
      adherenceSubtitle:  'Global view — all teachers',
      inContext:          'In context',
      outContext:         'Out of context',
      noDataTitle:        'No data available',
      noDataDesc:         'Statistics will appear after sessions are finalized.',
      sessionsInContext:  'Sessions in context',
      sessionsOutContext: 'Sessions out of context',
      ofTotal:            'of total',
      hoursLabel:         'Hours recorded',
      avgScore:           'Avg. context score',
      thisWeek:           'This week',
      thisMonth:          'This month',
      leaderboardTitle:   'Teacher adherence ranking',
      leaderboardSub:     'Sorted by in-context % (all-time, done sessions)',
      rankCol:            '#',
      teacherCol:         'Teacher',
      inCol:              'In',
      outCol:             'Out',
      adherencePct:       'Adherence',
      noTeachers:         'No data yet',
      failedSessions:     'Failed sessions',
      totalUsers:         'Total users',
      teachers:           'Teachers',
      pendingInvites:     'Pending invites',
      failedAlert:        'session(s) failed — needs attention',
      processingAlert:    'sessions stuck in processing — check the finalize worker',
      completionRate:     'Completion rate',
      outcomesTitle:      'Session outcomes',
      outcomesSub:        'All-time status breakdown',
      totalLabel:         'total',
    },
    fr: {
      last14:             '14 derniers jours',
      avgLine:            'Moy. quotidienne',
      adherenceTitle:     'Adhérence au programme',
      adherenceSubtitle:  'Vue globale — tous les enseignants',
      inContext:          'En contexte',
      outContext:         'Hors contexte',
      noDataTitle:        'Aucune donnée disponible',
      noDataDesc:         "Les statistiques apparaîtront une fois que des séances seront finalisées.",
      sessionsInContext:  'Séances en contexte',
      sessionsOutContext: 'Séances hors contexte',
      ofTotal:            'du total',
      hoursLabel:         'Heures enregistrées',
      avgScore:           'Score moyen',
      thisWeek:           'Cette semaine',
      thisMonth:          'Ce mois',
      leaderboardTitle:   'Classement des enseignants',
      leaderboardSub:     'Trié par % en contexte (depuis le début)',
      rankCol:            '#',
      teacherCol:         'Enseignant',
      inCol:              'En ctx.',
      outCol:             'Hors ctx.',
      adherencePct:       'Adhérence',
      noTeachers:         'Aucune donnée',
      failedSessions:     'Séances échouées',
      totalUsers:         'Utilisateurs',
      teachers:           'Enseignants',
      pendingInvites:     'Invitations en attente',
      failedAlert:        'séance(s) échouée(s) — action requise',
      processingAlert:    'séances bloquées en traitement — vérifiez le worker',
      completionRate:     'Taux de complétion',
      outcomesTitle:      'Résultats des séances',
      outcomesSub:        'Répartition des statuts (depuis le début)',
      totalLabel:         'total',
    },
    ar: {
      last14:             'آخر 14 يوماً',
      avgLine:            'المتوسط اليومي',
      adherenceTitle:     'الالتزام بالبرنامج',
      adherenceSubtitle:  'نظرة عامة — جميع الأساتذة',
      inContext:          'ضمن السياق',
      outContext:         'خارج السياق',
      noDataTitle:        'لا توجد بيانات متاحة',
      noDataDesc:         'ستظهر الإحصاءات بعد إنهاء الجلسات.',
      sessionsInContext:  'جلسات ضمن السياق',
      sessionsOutContext: 'جلسات خارج السياق',
      ofTotal:            'من الإجمالي',
      hoursLabel:         'ساعات مسجّلة',
      avgScore:           'متوسط النتيجة',
      thisWeek:           'هذا الأسبوع',
      thisMonth:          'هذا الشهر',
      leaderboardTitle:   'ترتيب الأساتذة',
      leaderboardSub:     'مرتّب حسب % ضمن السياق (كل الوقت)',
      rankCol:            '#',
      teacherCol:         'الأستاذ',
      inCol:              'ضمن',
      outCol:             'خارج',
      adherencePct:       'الالتزام',
      noTeachers:         'لا توجد بيانات',
      failedSessions:     'جلسات فاشلة',
      totalUsers:         'إجمالي المستخدمين',
      teachers:           'الأساتذة',
      pendingInvites:     'دعوات معلّقة',
      failedAlert:        'جلسة/جلسات فاشلة — تتطلب انتباهاً',
      processingAlert:    'جلسات عالقة في المعالجة — تحقق من العامل',
      completionRate:     'معدل الإنجاز',
      outcomesTitle:      'نتائج الجلسات',
      outcomesSub:        'توزيع الحالات (كل الوقت)',
      totalLabel:         'إجمالي',
    },
  }[locale];

  const [chartSessions, setChartSessions]   = useState<Session[]>([]);
  const [summary, setSummary]               = useState<SessionStatusSummary | null>(null);
  const [courseTotal, setCourseTotal]       = useState(0);
  const [teacherStats, setTeacherStats]     = useState<TeacherContextStat[]>([]);
  const [userSummary, setUserSummary]       = useState<UserRoleSummary | null>(null);
  const [overview, setOverview]             = useState<SessionStatsOverview | null>(null);
  const [loading, setLoading]               = useState(true);

  useEffect(() => {
    const safe = <T,>(p: Promise<T>, fallback: T): Promise<T> =>
      p.catch(() => fallback);

    Promise.all([
      safe(api.sessions.list({ limit: 200 }),         { items: [], total: 0, limit: 200, offset: 0, has_more: false }),
      safe(api.sessions.statusSummary(),              null as SessionStatusSummary | null),
      safe(api.courses.list({ limit: 1, offset: 0 }), { items: [], total: 0, limit: 1, offset: 0, has_more: false }),
      safe(api.sessions.teacherContextStats(),        [] as TeacherContextStat[]),
      safe(api.admin.usersSummary(),                  null as UserRoleSummary | null),
      safe(api.sessions.statsOverview(),              null as SessionStatsOverview | null),
    ])
      .then(([chartPage, statusSummary, coursesPage, ctxStats, userSum, overviewStats]) => {
        setChartSessions(chartPage.items);
        setSummary(statusSummary);
        setCourseTotal(coursesPage.total);
        setTeacherStats(ctxStats);
        setUserSummary(userSum);
        setOverview(overviewStats);
      })
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived health metrics ─────────────────────────────────────────────────
  const completedTotal = (summary?.done ?? 0) + (summary?.failed ?? 0);
  const completionRate = completedTotal > 0
    ? Math.round((summary?.done ?? 0) / completedTotal * 100)
    : null;


  // ── KPI cards ─────────────────────────────────────────────────────────────
  const sessionStats = [
    { label: t('session.status.done'),       value: summary?.done ?? 0,       icon: CheckCircle2, color: 'var(--success)', bg: 'var(--success-dim)' },
    { label: t('session.status.live'),       value: summary?.live ?? 0,       icon: Radio,        color: 'var(--danger)',  bg: 'var(--danger-dim)'  },
    { label: t('session.status.processing'), value: summary?.processing ?? 0, icon: Clock,        color: 'var(--warning)', bg: 'var(--warning-dim)' },
    { label: l.failedSessions,               value: summary?.failed ?? 0,     icon: AlertCircle,  color: 'var(--muted)',   bg: 'var(--surface-2)'   },
  ];
  const platformStats = [
    { label: t('course.title'),   value: courseTotal,                       icon: BookOpen,  color: 'var(--accent)',  bg: 'var(--accent-dim)'  },
    { label: l.totalUsers,        value: userSummary?.total ?? 0,           icon: Users,     color: 'var(--purple)',  bg: 'var(--purple-dim)'  },
    { label: l.teachers,          value: userSummary?.teachers ?? 0,        icon: UserCheck, color: 'var(--cyan)',    bg: 'var(--cyan-dim)'    },
    { label: l.pendingInvites,    value: userSummary?.pending_invites ?? 0, icon: MailOpen,  color: 'var(--warning)', bg: 'var(--warning-dim)' },
  ];
  const allStats = [...sessionStats, ...platformStats];

  // ── Overview chips ─────────────────────────────────────────────────────────
  const overviewChips = [
    {
      label: l.hoursLabel,
      value: overview ? fmtHours(overview.total_hours_minutes, locale) : '—',
      icon: Timer,
      color: 'var(--accent)',
    },
    {
      label: l.avgScore,
      value: overview?.avg_context_score != null
        ? `${Math.round(overview.avg_context_score * 100)}%` : '—',
      icon: Target,
      color: overview?.avg_context_score != null && overview.avg_context_score >= 0.8
        ? 'var(--success)'
        : overview?.avg_context_score != null && overview.avg_context_score >= 0.6
          ? 'var(--warning)' : 'var(--muted)',
    },
    {
      label: l.thisWeek,
      value: overview?.sessions_this_week ?? '—',
      icon: CalendarDays,
      color: 'var(--text-2)',
    },
    {
      label: l.thisMonth,
      value: overview?.sessions_this_month ?? '—',
      icon: CalendarCheck,
      color: 'var(--text-2)',
    },
    {
      label: l.completionRate,
      value: completionRate !== null ? `${completionRate}%` : '—',
      icon: Gauge,
      color: completionRate === null ? 'var(--muted)'
        : completionRate >= 90 ? 'var(--success)'
        : completionRate >= 70 ? 'var(--warning)'
        : 'var(--danger)',
    },
  ];

  // ── Area chart ─────────────────────────────────────────────────────────────
  const chartData = buildChartData(chartSessions, locale);
  const chartAvg  = chartData.length > 0
    ? Math.round(chartData.reduce((s, d) => s + d.sessions, 0) / chartData.length)
    : 0;

  // ── Session outcomes donut ─────────────────────────────────────────────────
  const outcomeData = [
    { name: t('session.status.done'),       value: summary?.done ?? 0,       color: C.success },
    { name: t('session.status.failed'),     value: summary?.failed ?? 0,     color: C.danger  },
    { name: t('session.status.processing'), value: summary?.processing ?? 0, color: C.warning },
    { name: t('session.status.created'),    value: summary?.created ?? 0,    color: C.accent  },
    { name: t('session.status.live'),       value: summary?.live ?? 0,       color: C.cyan    },
  ].filter(d => d.value > 0);
  const outcomeTotal = outcomeData.reduce((s, d) => s + d.value, 0);

  // ── Adherence donut ────────────────────────────────────────────────────────
  const totalIn  = teacherStats.reduce((s, r) => s + r.in_context, 0);
  const totalOut = teacherStats.reduce((s, r) => s + r.out_of_context, 0);
  const totalCtx = totalIn + totalOut;
  const inPct    = totalCtx > 0 ? Math.round((totalIn  / totalCtx) * 100) : 0;
  const outPct   = totalCtx > 0 ? Math.round((totalOut / totalCtx) * 100) : 0;
  const pieData  = [
    { name: l.inContext,  value: totalIn,  color: C.success },
    { name: l.outContext, value: totalOut, color: C.danger  },
  ].filter(d => d.value > 0);

  // ── Teacher leaderboard ────────────────────────────────────────────────────
  const leaderboard = [...teacherStats]
    .map(t => {
      const tot = t.in_context + t.out_of_context;
      return { ...t, total: tot, pct: tot > 0 ? Math.round((t.in_context / tot) * 100) : 0 };
    })
    .sort((a, b) => b.pct - a.pct);

  // ── Custom tooltip ─────────────────────────────────────────────────────────
  function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
    if (!active || !payload?.length) return null;
    return (
      <div className={styles.chartTooltip}>
        <p className={styles.chartTooltipLabel}>{label}</p>
        <p className={styles.chartTooltipValue}>{payload[0].value} {t('common.sessions')}</p>
      </div>
    );
  }

  function DonutTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { name: string; value: number } }> }) {
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
      <PageHeader
        title={t('sidebar.dashboard')}
        subtitle={t('sidebar.overview')}
        border
      />

      {/* ── Alert strip ──────────────────────────────────────────── */}
      {!loading && summary && (summary.failed > 0 || summary.processing > 5) && (
        <div className={styles.alertStrip}>
          {summary.failed > 0 && (
            <div className={styles.alertItem} data-variant="danger">
              <AlertCircle size={14} />
              <strong>{summary.failed}</strong> {l.failedAlert}
            </div>
          )}
          {summary.processing > 5 && (
            <div className={styles.alertItem} data-variant="warning">
              <Clock size={14} />
              <strong>{summary.processing}</strong> {l.processingAlert}
            </div>
          )}
        </div>
      )}

      {/* ── 8 KPI cards ──────────────────────────────────────────── */}
      <div className={styles.stats}>
        {allStats.map((s, i) => {
          const Icon = s.icon;
          return (
            <div
              key={s.label}
              className={styles.statCard}
              style={{
                '--stat-delay': `${i * 45}ms`,
                '--accent-color': s.color,
                '--accent-bg': s.bg,
              } as React.CSSProperties}
            >
              <div className={styles.statLeft}>
                <div className={styles.statIcon}><Icon size={17} strokeWidth={2} /></div>
              </div>
              <div className={styles.statBody}>
                <div className={styles.statValue}>
                  {loading
                    ? <span className={`${styles.skeleton} ${styles.statSkeleton}`} />
                    : s.value}
                </div>
                <div className={styles.statLabel}>{s.label}</div>
              </div>
              <div className={styles.statAccent} />
            </div>
          );
        })}
      </div>

      {/* ── Platform overview chips ───────────────────────────────── */}
      <div className={styles.overviewChips}>
        {overviewChips.map((chip, i) => {
          const Icon = chip.icon;
          return (
            <div
              key={chip.label}
              className={styles.overviewChip}
              style={{
                '--chip-delay': `${i * 40 + 360}ms`,
                '--chip-color': chip.color,
              } as React.CSSProperties}
            >
              <Icon size={14} className={styles.overviewChipIcon} />
              <span className={styles.overviewChipValue}>
                {loading ? <span className={`${styles.skeleton} ${styles.chipSkeleton}`} /> : chip.value}
              </span>
              <span className={styles.overviewChipLabel}>{chip.label}</span>
            </div>
          );
        })}
      </div>

      {/* ── Sessions activity area chart ─────────────────────────── */}
      <div className={styles.chartCard}>
        <SectionHeader title={t('session.title')} subtitle={l.last14} />
        <div className={styles.chartWrap}>
          {loading ? (
            <div className={styles.chartSkeleton} />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={chartData} margin={{ top: 10, right: 12, bottom: 0, left: -20 }}>
                <defs>
                  <linearGradient id="sessionGrad" x1="0" y1="0" x2="0" y2="1">
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
                  fill="url(#sessionGrad)"
                  dot={false}
                  activeDot={{ r: 5, fill: 'var(--accent)', stroke: 'var(--bg)', strokeWidth: 2.5 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ── 2-card row: Outcomes | Adherence ────────────────────── */}
      <div className={styles.chartsRow3}>

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
                      innerRadius={55} outerRadius={82}
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
                    <Tooltip content={(props) => <DonutTooltip {...(props as unknown as Parameters<typeof DonutTooltip>[0])} />} />
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

        {/* Program adherence donut */}
        <div className={styles.chartCard}>
          <SectionHeader title={l.adherenceTitle} subtitle={l.adherenceSubtitle} />
          {loading ? (
            <div className={styles.contextSkeleton}>
              <div className={`${styles.chartSkeleton} ${styles.chartSkeletonShort}`} />
            </div>
          ) : totalCtx === 0 ? (
            <EmptyState icon={BarChart3} title={l.noDataTitle} description={l.noDataDesc} />
          ) : (
            <div className={styles.contextBody}>
              <div className={styles.donutWrap}>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%" cy="50%"
                      innerRadius={58} outerRadius={84}
                      paddingAngle={3}
                      dataKey="value"
                      strokeWidth={0}
                      startAngle={90}
                      endAngle={-270}
                    >
                      {pieData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} opacity={0.9} />
                      ))}
                    </Pie>
                    <Tooltip content={(props) => <AdherenceTooltip {...(props as unknown as Parameters<typeof AdherenceTooltip>[0])} />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className={styles.donutCenter}>
                  <span className={styles.donutPct}>{inPct}%</span>
                  <span className={styles.donutLabel}>{l.inContext}</span>
                </div>
              </div>

              <div className={styles.contextLegend}>
                <div className={styles.contextStat}>
                  <div className={styles.contextStatIcon} data-variant="success">
                    <TrendingUp size={16} strokeWidth={2} />
                  </div>
                  <div>
                    <div className={styles.contextStatValue} data-variant="success">{totalIn}</div>
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
                    <div className={styles.contextStatValue} data-variant="danger">{totalOut}</div>
                    <div className={styles.contextStatLabel}>{l.sessionsOutContext}</div>
                    <div className={styles.contextStatPct}>{outPct}% {l.ofTotal}</div>
                  </div>
                </div>
                <div className={styles.contextBar}>
                  <div className={styles.contextBarFill} style={{ '--bar-w': `${inPct}%` } as React.CSSProperties} />
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

      {/* ── Teacher leaderboard (full width) ─────────────────────── */}
      <div className={styles.chartCard}>
        <SectionHeader title={l.leaderboardTitle} subtitle={l.leaderboardSub} />
        {loading ? (
          <div className={styles.contextSkeleton}>
            <div className={`${styles.chartSkeleton} ${styles.chartSkeletonShort}`} />
          </div>
        ) : leaderboard.length === 0 ? (
          <EmptyState icon={Medal} title={l.noTeachers} description={l.noDataDesc} />
        ) : (
          <div className={styles.leaderboardWrap}>
            <table className={styles.leaderboard}>
              <thead>
                <tr>
                  <th>{l.rankCol}</th>
                  <th>{l.teacherCol}</th>
                  <th className={styles.leaderboardNum}>{l.inCol}</th>
                  <th className={styles.leaderboardNum}>{l.outCol}</th>
                  <th className={styles.leaderboardBar}>{l.adherencePct}</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((row, idx) => (
                  <tr key={row.teacher_id}>
                    <td className={styles.leaderboardRank}>
                      {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1}
                    </td>
                    <td className={styles.leaderboardName}>{row.teacher_name}</td>
                    <td className={styles.leaderboardNum} data-good="true">{row.in_context}</td>
                    <td className={styles.leaderboardNum} data-bad="true">{row.out_of_context}</td>
                    <td className={styles.leaderboardBar}>
                      <div className={styles.leaderboardBarTrack}>
                        <div
                          className={styles.leaderboardBarFill}
                          style={{
                            '--row-w': `${row.pct}%`,
                            '--row-color': row.pct >= 80 ? 'var(--success)' : row.pct >= 60 ? 'var(--warning)' : 'var(--danger)',
                          } as React.CSSProperties}
                        />
                      </div>
                      <span
                        className={styles.leaderboardPct}
                        style={{ '--row-color': row.pct >= 80 ? 'var(--success)' : row.pct >= 60 ? 'var(--warning)' : 'var(--danger)' } as React.CSSProperties}
                      >
                        {row.pct}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}
