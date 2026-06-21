'use client';
import { useEffect, useState, useRef, useMemo } from 'react';
import { use } from 'react';
import { api } from '@/lib/api';
import type { Summary, TranscriptSegment } from '@/lib/types';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import FormAlert from '@/components/ui/FormAlert';
import { useLocale } from '@/lib/i18n/LanguageContext';
import { getErrorMessage } from '@/lib/errors';
import { exportSessionAsPDF } from '@/lib/exportDocument';
import {
  CalendarIcon, ClockIcon, GlobeIcon, TagIcon,
  TeacherIcon, UserIcon, HelpCircleIcon, FileTextIcon, DownloadIcon,
} from '@/components/ui/Icon';
import styles from './page.module.css';

// ── Shared helpers ────────────────────────────────────────────────────────────

type SpeakerFilter = 'all' | 'teacher' | 'participant' | 'unknown';

function formatMs(ms: number) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function highlight(text: string, query: string) {
  if (!query.trim()) return <>{text}</>;
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, i) =>
        regex.test(part)
          ? <mark key={i} className={styles.txHighlight}>{part}</mark>
          : part
      )}
    </>
  );
}

// ── TranscriptView ────────────────────────────────────────────────────────────

function TranscriptView({ segments, locale }: { segments: TranscriptSegment[]; locale: 'en' | 'fr' | 'ar' }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<SpeakerFilter>('all');
  const text = {
    en: {
      noSegments: 'No transcript segments found.',
      segments: 'segments',
      teacher: 'teacher',
      participant: 'participant',
      unknown: 'unknown',
      searchPlaceholder: 'Search transcript…',
      all: 'All',
      noMatch: 'No segments match your search.',
      teacherRole: 'Teacher',
      participantRole: 'Participant',
    },
    fr: {
      noSegments: 'Aucun segment de transcription trouvé.',
      segments: 'segments',
      teacher: 'enseignant',
      participant: 'participant',
      unknown: 'inconnu',
      searchPlaceholder: 'Rechercher dans la transcription…',
      all: 'Tout',
      noMatch: 'Aucun segment ne correspond à votre recherche.',
      teacherRole: 'Enseignant',
      participantRole: 'Participant',
    },
    ar: {
      noSegments: 'لم يتم العثور على مقاطع تفريغ.',
      segments: 'مقاطع',
      teacher: 'أستاذ',
      participant: 'مشارك',
      unknown: 'غير معروف',
      searchPlaceholder: 'ابحث في التفريغ…',
      all: 'الكل',
      noMatch: 'لا توجد مقاطع تطابق البحث.',
      teacherRole: 'أستاذ',
      participantRole: 'مشارك',
    },
  }[locale];

  const stats = useMemo(() => ({
    teacher:     segments.filter(s => s.speaker_role === 'teacher').length,
    participant: segments.filter(s => s.speaker_role === 'participant').length,
    unknown:     segments.filter(s => s.speaker_role === 'unknown').length,
    total:       segments.length,
  }), [segments]);

  const filtered = useMemo(() =>
    segments.filter(seg => {
      const roleOk = filter === 'all' || seg.speaker_role === filter;
      const textOk = !search.trim() || seg.text.toLowerCase().includes(search.toLowerCase());
      return roleOk && textOk;
    }),
  [segments, search, filter]);

  if (segments.length === 0) {
    return <div className={styles.txEmpty}>{text.noSegments}</div>;
  }

  return (
    <div className={styles.transcriptContainer}>
      {/* Stats bar */}
      <div className={styles.txStats}>
        <div className={styles.txStat}>
          <span className={styles.txStatValue}>{stats.total}</span>
          <span>{text.segments}</span>
        </div>
        <div className={styles.txStat}>
          <span className={`${styles.txStatDot} ${styles.txStatDotTeacher}`} />
          <span className={styles.txStatValue}>{stats.teacher}</span>
          <span>{text.teacher}</span>
        </div>
        {stats.participant > 0 && (
          <div className={styles.txStat}>
            <span className={`${styles.txStatDot} ${styles.txStatDotParticipant}`} />
            <span className={styles.txStatValue}>{stats.participant}</span>
            <span>{text.participant}</span>
          </div>
        )}
        {stats.unknown > 0 && (
          <div className={styles.txStat}>
            <span className={`${styles.txStatDot} ${styles.txStatDotUnknown}`} />
            <span className={styles.txStatValue}>{stats.unknown}</span>
            <span>{text.unknown}</span>
          </div>
        )}
      </div>

      {/* Search + filter toolbar */}
      <div className={styles.txToolbar}>
        <input
          type="text"
          className={styles.txSearch}
          placeholder={text.searchPlaceholder}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className={styles.txFilterGroup}>
          {(['all', 'teacher', 'participant', 'unknown'] as SpeakerFilter[]).map(f => (
            <button
              key={f}
              type="button"
              className={[
                styles.txFilterBtn,
                filter === f ? styles.txFilterBtnActive : '',
                f === 'teacher' ? styles.txFilterBtnTeacher : '',
                f === 'participant' ? styles.txFilterBtnParticipant : '',
              ].filter(Boolean).join(' ')}
              onClick={() => setFilter(f)}
            >
              {f === 'all'
                ? text.all
                : f === 'teacher'
                  ? text.teacher
                  : f === 'participant'
                    ? text.participant
                    : text.unknown}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className={styles.txEmpty}>{text.noMatch}</div>
      ) : (
        <div className={styles.transcriptList}>
          {filtered.map((seg, i) => {
            const isTeacher     = seg.speaker_role === 'teacher';
            const isParticipant = seg.speaker_role === 'participant';
            const prevSeg       = i > 0 ? filtered[i - 1] : null;
            const isSameSpeaker = prevSeg?.speaker_label === seg.speaker_label;

            return (
              <div
                key={seg.id}
                className={styles.txSeg}
              >
                <div className={styles.txLeft}>
                  {!isSameSpeaker && (
                    <div className={[
                      styles.txAvatar,
                      isTeacher     ? styles.txAvatarTeacher     : '',
                      isParticipant ? styles.txAvatarParticipant : '',
                    ].filter(Boolean).join(' ')}>
                      {isTeacher ? <TeacherIcon size={14} /> : isParticipant ? <UserIcon size={14} /> : <HelpCircleIcon size={14} />}
                    </div>
                  )}
                  {isSameSpeaker && <div className={styles.txConnector} />}
                  <span className={styles.txTime}>{formatMs(seg.segment_start_ms)}</span>
                </div>
                <div className={styles.txRight}>
                  {!isSameSpeaker && (
                    <span className={[
                      styles.txRole,
                      isTeacher     ? styles.txRoleTeacher     : '',
                      isParticipant ? styles.txRoleParticipant : '',
                      !isTeacher && !isParticipant ? styles.txRoleUnknown : '',
                    ].filter(Boolean).join(' ')}>
                      {seg.speaker_label}
                      {isTeacher ? ` · ${text.teacherRole}` : isParticipant ? ` · ${text.participantRole}` : ''}
                    </span>
                  )}
                  <p className={styles.txText}>{highlight(seg.text, search)}</p>
                  {seg.language && (
                    <span className={styles.txLang}>{seg.language.toUpperCase()}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { locale, isRTL } = useLocale();
  const [session, setSession] = useState<any>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [tab, setTab] = useState<'outline' | 'transcript'>('outline');
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [txLoading, setTxLoading] = useState(false);
  const [error, setError] = useState('');
  const [txError, setTxError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const tabsRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<{ [key: string]: HTMLButtonElement | null }>({});

  useEffect(() => {
    const el = tabRefs.current[tab];
    if (el && indicatorRef.current) {
      indicatorRef.current.style.insetInlineStart = `${el.offsetLeft}px`;
      indicatorRef.current.style.width = `${el.offsetWidth}px`;
    }
  }, [tab, loading]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  useEffect(() => {
    async function init() {
      try {
        const sess = await api.sessions.get(id);
        setSession(sess);
        if (sess.status === 'processing') {
          setPolling(true);
          pollRef.current = setInterval(async () => {
            try {
              const updated = await api.sessions.get(id);
              setSession(updated);
              if (updated.status === 'done' || updated.status === 'failed') {
                clearInterval(pollRef.current!);
                pollRef.current = null;
                setPolling(false);
                if (updated.status === 'done') {
                  try { setSummary(await api.sessions.summary(id)); } catch { /* ignore */ }
                }
              }
            } catch { /* ignore transient errors */ }
          }, 4000);
        } else if (sess.status === 'done') {
          setSummary(await api.sessions.summary(id));
        }
      } catch (err) {
        setError(getErrorMessage(err, 'Failed to load session'));
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [id]);

  async function loadTranscript() {
    if (transcript.length > 0) return;
    setTxLoading(true);
    setTxError('');
    try {
      setTranscript(await api.sessions.transcript(id));
    } catch (err) {
      setTxError(getErrorMessage(err, 'Failed to load transcript'));
    } finally {
      setTxLoading(false);
    }
  }

  function switchTab(t: 'outline' | 'transcript') {
    setTab(t);
    if (t === 'transcript') loadTranscript();
  }

  // ── Loading skeleton ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className={styles.loadingWrap}>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className={`${styles.skeletonCard} ${styles[`skDelay${i}`]}`}>
            <span className={`skeleton-line ${styles.sk1}`} />
            <span className={`skeleton-line ${styles.sk2}`} />
            <span className={`skeleton-line ${styles.sk3}`} />
            <span className={`skeleton-line ${styles.sk4}`} />
          </div>
        ))}
      </div>
    );
  }

  if (error) return <div className={styles.errorBox}><FormAlert message={error} /></div>;
  if (!session && !summary) {
    return <div className={styles.mutedBox}>{locale === 'ar' ? 'الجلسة غير موجودة.' : locale === 'fr' ? 'Séance introuvable.' : 'Session not found.'}</div>;
  }

  // ── PROCESSING banner (full-page while LLM job runs) ───────────────────────
  if (polling && !summary) {
    return (
      <div className={styles.page}>
        <PageHeader
          breadcrumbs={[{ label: locale === 'ar' ? 'الجلسات' : locale === 'fr' ? 'Séances' : 'Sessions', href: '/admin/sessions' }, { label: session?.title || (locale === 'ar' ? 'جلسة' : locale === 'fr' ? 'Séance' : 'Session') }]}
          title={session?.title || (locale === 'ar' ? 'جلسة' : locale === 'fr' ? 'Séance' : 'Session')}
          subtitle={locale === 'ar' ? 'جاري إنشاء مخطط المواضيع…' : locale === 'fr' ? 'Génération du plan de séance…' : 'Generating topic outline…'}
          border={false}
        />
        <div className={styles.processingBanner}>
          <span className={styles.processingSpinner} />
          {locale === 'ar'
            ? 'جاري إنشاء مخطط المواضيع… يستغرق ذلك عادة من 20 إلى 60 ثانية. سيتم تحديث الصفحة تلقائياً.'
            : locale === 'fr'
              ? 'Génération du plan de séance… Cela prend généralement 20 à 60 secondes. La page se met à jour automatiquement.'
              : 'Generating topic outline… This usually takes 20–60 seconds. The page will update automatically.'}
        </div>
      </div>
    );
  }

  const o = (summary?.content ?? {}) as Partial<Summary['content']>;
  const totalTopics = o.topics?.length ?? 0;

  return (
    <div className={styles.page}>
      <PageHeader
        breadcrumbs={[
          { label: locale === 'ar' ? 'الجلسات' : locale === 'fr' ? 'Séances' : 'Sessions', href: '/admin/sessions' },
          { label: o.course_title || session?.title || (locale === 'ar' ? 'جلسة' : locale === 'fr' ? 'Séance' : 'Session') },
          { label: o.session_title || '' },
        ]}
        title={o.session_title || session?.title || (locale === 'ar' ? 'جلسة' : locale === 'fr' ? 'Séance' : 'Session')}
        subtitle={o.teacher_name && o.course_title ? `${o.teacher_name} · ${o.course_title}` : ''}
        border={false}
        action={
          summary && (
            <div className={styles.pageActions}>
              <Button
                variant="outline"
                size="sm"
                onClick={() => exportSessionAsPDF(summary, session?.id)}
              >
                <DownloadIcon size={14} /> {locale === 'ar' ? 'تصدير PDF' : locale === 'fr' ? 'Exporter PDF' : 'Export PDF'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const blob = new Blob([JSON.stringify(o, null, 2)], { type: 'application/json' });
                  const a = document.createElement('a');
                  a.href = URL.createObjectURL(blob);
                  a.download = `${o.session_title || 'session'}.json`;
                  a.click();
                }}
              >
                JSON
              </Button>
            </div>
          )
        }
      />

      <div className={styles.metaStrip}>
        {o.recorded_at && (
          <div className={styles.metaChip}>
            <CalendarIcon size={12} />
            {new Date(o.recorded_at).toLocaleString('fr-DZ', { dateStyle: 'medium', timeStyle: 'short' })}
          </div>
        )}
        {o.duration_minutes != null && <div className={styles.metaChip}><ClockIcon size={12} />{o.duration_minutes} min</div>}
        {session?.status === 'done' && o.language && (
          <div className={styles.metaChip}><GlobeIcon size={12} />{o.language.toUpperCase()}</div>
        )}
        <div className={styles.metaChip}><TagIcon size={12} />{totalTopics} {locale === 'ar' ? 'مواضيع' : locale === 'fr' ? 'sujets' : 'topics'}</div>
        <Badge variant={session?.status === 'failed' ? 'danger' : session?.status === 'processing' ? 'warning' : 'success'}>
          {session?.status === 'processing'
            ? (locale === 'ar' ? 'قيد المعالجة' : locale === 'fr' ? 'EN COURS' : 'PROCESSING')
            : session?.status === 'done'
              ? (locale === 'ar' ? 'مكتمل' : locale === 'fr' ? 'TERMINÉ' : 'DONE')
              : session?.status === 'failed'
                ? (locale === 'ar' ? 'فشل' : locale === 'fr' ? 'ÉCHOUÉ' : 'FAILED')
                : (session?.status ?? '').toUpperCase()}
        </Badge>
      </div>

      {/* PROCESSING inline banner (session loaded but still processing) */}
      {polling && (
        <div className={styles.processingBanner}>
          <span className={styles.processingSpinner} />
          {locale === 'ar'
            ? 'جاري إنشاء مخطط الجلسة… يستغرق ذلك عادة من 20 إلى 60 ثانية. سيتم تحديث الصفحة تلقائياً.'
            : locale === 'fr'
              ? 'Génération du plan de séance en cours… Cela prend généralement 20 à 60 secondes. La page se met à jour automatiquement.'
              : 'Generating session outline… This usually takes 20 to 60 seconds. The page updates automatically.'}
        </div>
      )}

      {/* Tab bar */}
      <div className={styles.tabBar} ref={tabsRef}>
        {(['outline', 'transcript'] as const).map(t => (
          <button
            key={t}
            ref={el => { tabRefs.current[t] = el; }}
            type="button"
            className={[styles.tabBtn, tab === t ? styles.tabBtnActive : ''].join(' ')}
            onClick={() => switchTab(t)}
          >
            {t === 'outline'
              ? `${locale === 'ar' ? 'مخطط الجلسة' : locale === 'fr' ? 'Plan de séance' : 'Session outline'} (${totalTopics})`
              : (locale === 'ar' ? 'التفريغ' : locale === 'fr' ? 'Transcription' : 'Transcript')}
          </button>
        ))}
        <div ref={indicatorRef} className={styles.tabIndicator} />
      </div>

      {/* Topic outline tab */}
      {tab === 'outline' && (
        <div className={styles.topics}>
          {!o.topics || o.topics.length === 0 ? (
            <div className={styles.empty}>
              <span className={styles.emptyIco}><FileTextIcon size={40} /></span>
              <p>{locale === 'ar' ? 'لم يتم استخراج مواضيع من هذه الجلسة.' : locale === 'fr' ? 'Aucun sujet n’a été extrait de cette séance.' : 'No topics were extracted from this session.'}</p>
            </div>
          ) : (
            o.topics.map((topic: any, i: number) => (
              <div key={topic.title + topic.start_time + i} className={styles.topicCard}>
                <div className={styles.topicTimestamp}>{isRTL ? `${topic.end_time} – ${topic.start_time}` : `${topic.start_time} – ${topic.end_time}`}</div>
                <h3 className={styles.topicTitle}>{topic.title}</h3>
                <p className={styles.topicDesc}>{topic.description}</p>
                {topic.key_concepts?.length > 0 && (
                  <div className={styles.concepts}>
                    {topic.key_concepts.map((c: string, j: number) => (
                      <span key={j} className={styles.concept}>{c}</span>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Transcript tab */}
      {tab === 'transcript' && (
        <div>
          {txError && <FormAlert message={txError} />}
          {txLoading ? (
            <div className={styles.txLoading}>
              <span className={styles.txSpinner} />
              {locale === 'ar' ? 'جارٍ تحميل التفريغ…' : locale === 'fr' ? 'Chargement de la transcription…' : 'Loading transcript…'}
            </div>
          ) : (
            <TranscriptView segments={transcript} locale={locale} />
          )}
        </div>
      )}
    </div>
  );
}
