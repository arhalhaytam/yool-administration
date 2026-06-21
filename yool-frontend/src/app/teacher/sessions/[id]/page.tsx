'use client';
import { useEffect, useState, useRef, useMemo } from 'react';
import { use } from 'react';
import { Pencil, Target } from 'lucide-react';
import { api } from '@/lib/api';
import type { Summary, TranscriptSegment } from '@/lib/types';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import FormAlert from '@/components/ui/FormAlert';
import { getErrorMessage } from '@/lib/errors';
import { useLocale, useT } from '@/lib/i18n/LanguageContext';
import { useApiErrors } from '@/lib/i18n/useApiErrors';
import { exportSessionAsPDF } from '@/lib/exportDocument';
import {
  CalendarIcon, ClockIcon, GlobeIcon, TagIcon,
  TeacherIcon, UserIcon, HelpCircleIcon, FileTextIcon,
  DownloadIcon, RefreshIcon,
} from '@/components/ui/Icon';
import styles from '@/app/admin/sessions/[id]/page.module.css';

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

function TranscriptView({ segments }: { segments: TranscriptSegment[] }) {
  const t = useT();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<SpeakerFilter>('all');

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

  const filterLabels: Record<SpeakerFilter, string> = {
    all:         t('common.all'),
    teacher:     t('session.teacher'),
    participant: t('session.participant'),
    unknown:     t('session.unknown'),
  };

  const groupedSegments = useMemo(() => {
    const groups: Array<{
      id: string;
      speaker_label: string;
      speaker_role: string;
      segments: TranscriptSegment[];
    }> = [];
    for (const seg of filtered) {
      if (groups.length > 0 && groups[groups.length - 1].speaker_label === seg.speaker_label) {
        groups[groups.length - 1].segments.push(seg);
      } else {
        groups.push({
          id: seg.id,
          speaker_label: seg.speaker_label,
          speaker_role: seg.speaker_role,
          segments: [seg],
        });
      }
    }
    return groups;
  }, [filtered]);

  if (segments.length === 0) return <div className={styles.txEmpty}>{t('sessionDetail.noTranscript')}</div>;

  return (
    <div className={styles.transcriptContainer}>
      <div className={styles.txStats}>
        <div className={styles.txStat}>
          <span className={styles.txStatValue}>{stats.total}</span><span>{t('sessionDetail.segments')}</span>
        </div>
        <div className={styles.txStat}>
          <span className={`${styles.txStatDot} ${styles.txStatDotTeacher}`} />
          <span className={styles.txStatValue}>{stats.teacher}</span><span>{t('record.teacher')}</span>
        </div>
        {stats.participant > 0 && (
          <div className={styles.txStat}>
            <span className={`${styles.txStatDot} ${styles.txStatDotParticipant}`} />
            <span className={styles.txStatValue}>{stats.participant}</span><span>{t('record.participant')}</span>
          </div>
        )}
        {stats.unknown > 0 && (
          <div className={styles.txStat}>
            <span className={`${styles.txStatDot} ${styles.txStatDotUnknown}`} />
            <span className={styles.txStatValue}>{stats.unknown}</span><span>{t('record.unknown')}</span>
          </div>
        )}
      </div>

      <div className={styles.txToolbar}>
        <input
          type="text"
          className={styles.txSearch}
          placeholder={t('session.searchTranscript')}
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
              {filterLabels[f]}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className={styles.txEmpty}>{t('session.noMatch')}</div>
      ) : (
        <div className={styles.transcriptList}>
          {groupedSegments.map((group) => {
            const isTeacher     = group.speaker_role === 'teacher';
            const isParticipant = group.speaker_role === 'participant';

            return (
              <div key={group.id} className={styles.txSeg}>
                <div className={styles.txLeft}>
                  <div className={[
                    styles.txAvatar,
                    isTeacher     ? styles.txAvatarTeacher     : '',
                    isParticipant ? styles.txAvatarParticipant : '',
                  ].filter(Boolean).join(' ')}>
                    {isTeacher ? <TeacherIcon size={14} /> : isParticipant ? <UserIcon size={14} /> : <HelpCircleIcon size={14} />}
                  </div>
                </div>
                <div className={styles.txRight}>
                  <span className={[
                    styles.txRole,
                    isTeacher     ? styles.txRoleTeacher     : '',
                    isParticipant ? styles.txRoleParticipant : '',
                    !isTeacher && !isParticipant ? styles.txRoleUnknown : '',
                  ].filter(Boolean).join(' ')}>
                    {isTeacher ? t('record.teacher') : isParticipant ? t('record.participant') : `${t('record.unknown')} (${group.speaker_label})`}
                  </span>
                  
                  <div className={styles.txTextGroup}>
                    {group.segments.map(seg => (
                      <p key={seg.id} className={styles.txText}>
                        <span className={styles.txInlineTime}>[{formatMs(seg.segment_start_ms)}]</span>
                        {' '}{highlight(seg.text, search)}
                        {seg.language && <span className={styles.txLang}>{seg.language.toUpperCase()}</span>}
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function TeacherSessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useT();
  const { locale, isRTL } = useLocale();
  const apiErrors = useApiErrors();
  const lStrings = {
    en: { rename: 'Rename session', renameBtn: 'Rename', contextScore: 'Context score' },
    fr: { rename: 'Renommer la séance', renameBtn: 'Renommer', contextScore: 'Score contextuel' },
    ar: { rename: 'إعادة تسمية الجلسة', renameBtn: 'إعادة تسمية', contextScore: 'نتيجة السياق' },
  }[locale];

  const [session, setSession] = useState<any>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [tab, setTab] = useState<'outline' | 'transcript'>('outline');
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [txLoading, setTxLoading] = useState(false);
  const [retryLoading, setRetryLoading] = useState(false);
  const [error, setError] = useState('');
  const [txError, setTxError] = useState('');
  const [showRename, setShowRename] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);
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
                  try { setSummary(await api.sessions.summary(id)); } catch { /* no summary yet */ }
                }
              }
            } catch { /* ignore transient errors */ }
          }, 4000);
        } else if (sess.status === 'done' || sess.status === 'failed') {
          try {
            setSummary(await api.sessions.summary(id));
          } catch (e: any) {
            if (!e.message?.includes('Topic outline not yet generated') && !e.message?.includes('Topic outline not ready')) {
              console.warn('Summary fetch error', e);
            }
          }
        }
      } catch (err) {
        setError(getErrorMessage(err, t('common.error'), apiErrors));
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [id]);

  async function handleRetry() {
    setRetryLoading(true);
    setError('');
    try {
      await api.sessions.retrySummary(id);
      window.location.reload();
    } catch (err) {
      setError(getErrorMessage(err, t('common.error'), apiErrors));
    } finally {
      setRetryLoading(false);
    }
  }

  async function loadTranscript() {
    if (transcript.length > 0) return;
    setTxLoading(true);
    setTxError('');
    try {
      setTranscript(await api.sessions.transcript(id));
    } catch (err) {
      setTxError(getErrorMessage(err, t('common.error'), apiErrors));
    } finally {
      setTxLoading(false);
    }
  }

  function switchTab(t: 'outline' | 'transcript') {
    setTab(t);
    if (t === 'transcript') loadTranscript();
  }

  async function handleRename(e: React.FormEvent) {
    e.preventDefault();
    if (!renameDraft.trim()) return;
    setRenameSaving(true);
    try {
      const updated = await api.sessions.update(id, { title: renameDraft.trim() });
      setSession(updated);
      setShowRename(false);
    } catch (err) {
      setError(getErrorMessage(err, t('common.error'), apiErrors));
    } finally {
      setRenameSaving(false);
    }
  }

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
  if (!session) return <div className={styles.mutedBox}>{t('sessionDetail.sessionNotFound')}</div>;

  const o = summary?.content || {
    session_title: session.title,
    course_title: '',
    teacher_name: '',
    recorded_at: session.started_at,
    duration_minutes: session.ended_at
      ? Math.round((new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()) / 60000)
      : 0,
    language: session.dominant_language || 'en',
    topics: [],
  };
  const totalTopics = o.topics?.length ?? 0;

  return (
    <div className={styles.page}>
      <PageHeader
        breadcrumbs={[
          { label: t('session.mySessions'), href: '/teacher/sessions' },
          ...(o.course_title && o.course_title !== session.title && o.course_title !== o.session_title ? [{ label: o.course_title }] : []),
          { label: o.session_title || session.title },
        ]}
        title={o.session_title || session.title}
        subtitle={o.teacher_name && o.course_title ? `${o.teacher_name} · ${o.course_title}` : ''}
        border={false}
        action={
          <div className={styles.pageActions}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setRenameDraft(session.title); setShowRename(true); }}
              title={lStrings.rename}
            >
              <Pencil size={14} />
            </Button>
            {summary && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => exportSessionAsPDF(summary, id)}
                >
                  <DownloadIcon size={14} /> {t('common.exportPDF')}
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
                  {t('common.exportJSON')}
                </Button>
              </>
            )}
          </div>
        }
      />

      <div className={styles.metaStrip}>
        {o.recorded_at && (
          <div className={styles.metaChip}>
            <CalendarIcon size={12} />
            {new Date(o.recorded_at).toLocaleString(
              locale === 'fr' ? 'fr-DZ' : locale === 'ar' ? 'ar-DZ' : 'en-US',
              { dateStyle: 'medium', timeStyle: 'short' },
            )}
          </div>
        )}
        <div className={styles.metaChip}><ClockIcon size={12} />{o.duration_minutes} {t('common.min')}</div>
        {/* Language chip only shown once confirmed by the LLM outline (DONE state) */}
        {session.status === 'done' && o.language && (
          <div className={styles.metaChip}><GlobeIcon size={12} />{o.language.toUpperCase()}</div>
        )}
        <div className={styles.metaChip}><TagIcon size={12} />{totalTopics} {t('sessionDetail.topics')}</div>
        {session.status === 'done' && summary?.content?.context_score != null && (
          <div
            className={styles.metaChip}
            style={{
              color: summary.content.context_score >= 0.8
                ? 'var(--success)'
                : summary.content.context_score >= 0.6
                  ? 'var(--warning)'
                  : 'var(--danger)',
            }}
          >
            <Target size={12} />
            {Math.round(summary.content.context_score * 100)}%
            <span style={{ fontSize: 10, color: 'var(--muted)', marginInlineStart: 2 }}>
              {lStrings.contextScore}
            </span>
          </div>
        )}
        <Badge variant={session.status === 'failed' ? 'danger' : session.status === 'processing' ? 'warning' : 'success'}>
          {session.status === 'processing' ? t('sessionDetail.statusProcessing') : session.status === 'done' ? t('sessionDetail.statusDone') : session.status === 'failed' ? t('sessionDetail.statusFailed') : session.status.toUpperCase()}
        </Badge>
      </div>

      {polling && (
        <div className={styles.processingBanner}>
          <span className={styles.processingSpinner} />
          {t('sessionDetail.generatingOutline')}
        </div>
      )}

      <div className={styles.tabBar} ref={tabsRef}>
        {(['outline', 'transcript'] as const).map(tabKey => (
          <button
            key={tabKey}
            ref={el => { tabRefs.current[tabKey] = el; }}
            type="button"
            className={[styles.tabBtn, tab === tabKey ? styles.tabBtnActive : ''].join(' ')}
            onClick={() => switchTab(tabKey)}
          >
            {tabKey === 'outline' ? `${t('sessionDetail.tabOutline')} (${totalTopics})` : t('sessionDetail.tabTranscript')}
          </button>
        ))}
        <div ref={indicatorRef} className={styles.tabIndicator} />
      </div>

      {tab === 'outline' && (
        <div className={styles.topics}>
          {error && <FormAlert message={error} />}
          {!summary || totalTopics === 0 ? (
            <div className={styles.empty}>
              <span className={styles.emptyIco}><FileTextIcon size={40} /></span>
              <p>{t('sessionDetail.noTopics')}</p>
              {(session.status === 'done' || session.status === 'failed') && (
                <Button onClick={handleRetry} disabled={retryLoading} variant="primary">
                  <RefreshIcon size={14} />{retryLoading ? t('sessionDetail.generating') : t('sessionDetail.retryGeneration')}
                </Button>
              )}
            </div>
          ) : (
            o.topics.map((topic: any, i: number) => (
              <div key={topic.title + i} className={styles.topicCard}>
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

      {tab === 'transcript' && (
        <div>
          {txError && <FormAlert message={txError} />}
          {txLoading ? (
            <div className={styles.txLoading}><span className={styles.txSpinner} />{t('sessionDetail.loadingTranscript')}</div>
          ) : (
            <TranscriptView segments={transcript} />
          )}
        </div>
      )}

      {/* ── Rename session modal ──────────────────────────────────── */}
      <Modal
        isOpen={showRename}
        onClose={() => setShowRename(false)}
        title={lStrings.rename}
        size="sm"
      >
        <form onSubmit={handleRename} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Input
            label={t('session.title')}
            value={renameDraft}
            onChange={e => setRenameDraft(e.target.value)}
            autoFocus
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button type="button" variant="ghost" onClick={() => setShowRename(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={renameSaving} disabled={!renameDraft.trim()}>
              {t('common.confirm')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
